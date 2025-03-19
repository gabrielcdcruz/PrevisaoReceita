import { loadStyle } from 'lightning/platformResourceLoader';
import globalStyles from '@salesforce/resourceUrl/globalStyles';

import getParcelas from "@salesforce/apex/PrevisaoReceitaParcelamentoController.getParcelas";
import adicionarParcela from "@salesforce/apex/PrevisaoReceitaParcelamentoController.adicionarParcela";
import atualizarParcela from "@salesforce/apex/PrevisaoReceitaParcelamentoController.atualizarParcela";
import removerParcela from "@salesforce/apex/PrevisaoReceitaParcelamentoController.removerParcela";
import gerarNovaVersao from "@salesforce/apex/PrevisaoReceitaParcelamentoController.gerarNovaVersao";
import { LightningElement, api, track, wire } from "lwc";
import {
  getRecord,
  getFieldValue,
  notifyRecordUpdateAvailable
} from "lightning/uiRecordApi";
import ITEM_PREVISAO_RECEITA from "@salesforce/schema/Item_Previsao_Receita__c";
import { refreshApex } from "@salesforce/apex";
import LightningPrompt from "lightning/prompt";
import LightningConfirm from "lightning/confirm";
import Toast from "lightning/toast";

import { NavigationMixin } from "lightning/navigation";

import VALOR_TOTAL_RECEITAS_FIELD from "@salesforce/schema/Previsao_Receita__c.Valor_total_de_receitas__c";
import ALLOW_EDITION_FIELD from "@salesforce/schema/Previsao_Receita__c.allowEdition__c";
import IS_LAST_VERSION_FIELD from "@salesforce/schema/Previsao_Receita__c.isLastVersion__c";
import { getObjectInfo } from "lightning/uiObjectInfoApi";

import PrevisaoReceitasParcelamentoRateios from "c/previsaoReceitasParcelamentoRateios";

export default class PrevisaoReceitasParcelamento extends NavigationMixin(
  LightningElement
) {
  /**
   * @typedef Item_Previsao_Receita__c
   * @type {object}
   * @property {string} Id
   * @property {string} Name
   * @property {string} Previsao_receita__c
   * @property {string} Previsao_pai__c
   * @property {string} Data__c
   * @property {string} Data_do_recebimento__c
   * @property {string} Data_do_recebimento_informada__c
   * @property {number} Numero_parcela__c
   * @property {number} Quantidade_parcela__c
   * @property {number} Valor__c
   * @property {string} Observacao__c
   * @property {string} Centro_Custo__c
   */

  @api recordId;
  timeout;
  @track isLoading = true;
  @track isCollapsed = false;
  columns = [
    { title: 'Número da parcela', content: 'Parcela', type: 'text' },
    { title: 'Data', content: 'Data' },
    { title: 'Data recebimento', content: 'Data do \nrecebimento', type: 'text'  },
    { title: 'Valor', content: 'Valor', type: 'text'  },
    { title: 'Valor faturado', content: 'Valor \nfaturado', type: 'text'  },
    { title: 'Valor retenção', content: 'Valor da \nretenção', type: 'text'  },
    { title: 'Centro de custo', content: 'Centro de custo', type: 'text'  },
    { title: 'Faturado', content: 'Faturado', type: 'text'  },
    { title: 'Recebido', content: 'Recebido', type: 'text'  },
    { title: 'REIDI', content: 'REIDI', type: 'text'  },
    { title: 'Retenção', content: 'Retenção', type: 'text'  },
    { title: 'Observação', content: 'Observação', type: 'text'  },
  ];

  _wiredObjectInfo;
  @wire(getObjectInfo, { objectApiName: ITEM_PREVISAO_RECEITA })
  wiredObjectInfo(result) {
    this._wiredObjectInfo = result;
    //console.log(result.data);
  }

  connectedCallback() {
    loadStyle(this, globalStyles);
  }

  getFieldNameLabel(fieldName) {
    return this._wiredObjectInfo.data.fields[fieldName].label;
  }

  @wire(getRecord, {
    recordId: "$recordId",
    fields: [
      VALOR_TOTAL_RECEITAS_FIELD,
      ALLOW_EDITION_FIELD,
      IS_LAST_VERSION_FIELD
    ]
  })
  record;

  get naoPermitirEdicao() {
    return !this.permitirEdicao;
  }

  get permitirEdicao() {
    return getFieldValue(this.record.data, ALLOW_EDITION_FIELD);
  }

  get podeGerarNovaVersao() {
    return (
      this.naoPermitirEdicao &&
      getFieldValue(this.record.data, IS_LAST_VERSION_FIELD)
    );
  }

  /**
   * @type {Item_Previsao_Receita__c[]}
   */
  @track parcelas = [];
  parcelasOriginais = [];
  rateiosOriginaisPorParcela = {};
  rateiosOriginais = [];
  @track percentual = 0;

  get percentualValido() {
    return this.percentual < 0 || this.percentual > 100;
  }

  /** @type {Item_Previsao_Receita__c} */
  @track parcelaSelecionada;
  @track parcelaSelecionadaIdx;

  @track valorTotalCalculado = 0;
  @track saldoTotalCalculado = 0;

  get saldoTotalStyled() {
    let styles = ["slds-text-align_right"];
    if (this.saldoTotalCalculado < 0) {
      styles.push("slds-text-color_error");
    } else if (this.saldoTotalCalculado > 0) {
      styles.push("slds-text-color_success");
    }
    return styles.join(" ");
  }

  // Os patches são modificações ainda não salvas.
  patches = [];

  _wiredParcelas;
  @wire(getParcelas, { previsaoReceitaId: "$recordId" })
  wiredParcelas(result) {
    this._wiredParcelas = result;
    const { data, error } = result;
    //console.log("Atualizando parcelas...");
    if (data) {
      this.atualizarParcelas(data);
    } else if(error) {
      console.log(error, "deu xabu", this.recordId);
    }
    this.isLoading = false;    
  }

  async atualizarParcelas(data) {
    // Copia os dados, ja que eles são imutáveis.
    // E adiciona as regras de estilização.
    const _class = this;
    
    // Salva como backup para o comando de desfazer.
    //this.parcelasOriginais = data.map((item) => ({ ...item }));
    this.parcelasOriginais = JSON.parse(JSON.stringify(data));
    var rateiosProvisorios = {};
    this.parcelasOriginais.forEach(parcela => {
      rateiosProvisorios[parcela.Id] = parcela.Rateio_Previsao_de_Receita__r;
    })
    if(Object.keys(this.rateiosOriginaisPorParcela).length === 0){
      this.rateiosOriginaisPorParcela = rateiosProvisorios;
    };

    this.parcelas = data.map((item) => ({
      ...item,
      deuErro: false,
      mensagemDeErro:'',
      isDirty: false,
      get styledClass() {
        let styles = ["slds-hint-parent"];

        if (_class.parcelaSelecionada) {
          if (_class.parcelaSelecionada.Id === this.Id)
            styles.push("slds-is-selected");
        }
        return styles.join(" ");
      }
    }));

    // Se houver uma parcela selecionada, então reecontra ela e marca novamente como a atual.
    if (this.parcelaSelecionada) {
      const idx = this.parcelas.findIndex(
        (item) => item.Id === this.parcelaSelecionada.Id
      );
      if (idx >= 0) {
        this._handleSelecionarParcelaByIndex(idx);
      }
    }

    this.aplicarPatches();
    this.recalcularTotal();
    //console.log('Saldo calculado: ', this.saldoTotalCalculado);
  }

  recalcularTotal() {
    //console.log('Recalculando total...')
    let totalCalculado = this.parcelas.reduce((total, item) => total + parseFloat(item.Valor__c), 0);
    //console.log('totalCalculado: ', totalCalculado);
    let totalReceitasField = getFieldValue(this.record.data, VALOR_TOTAL_RECEITAS_FIELD);
    //console.log('totalReceitasField: ', totalReceitasField);

    this.valorTotalCalculado = totalCalculado.toFixed(2);
    this.saldoTotalCalculado = (totalReceitasField - totalCalculado).toFixed(2);

    if (this.saldoTotalCalculado === "-0.00"){
      this.saldoTotalCalculado = 0.00;
    }
  }

  salvarPatches() {
    let patches = this.parcelas
    .filter((parcela) => parcela.isDirty)
    .map((parcela) => ({ ...parcela }));
    this.patches = JSON.parse(JSON.stringify(patches));
  }

  aplicarPatches() {
    for (const patch of this.patches) {
      const idx = this.parcelas.findIndex((parcela) => parcela.Id === patch.Id);
      if (idx >= 0) {
        Object.keys(patch).forEach((property) => {
          if(property !== 'Rateio_Previsao_de_Receita__r'){
            this.parcelas[idx][property] = patch[property];
          }
        });
        this.parcelas[idx].isDirty = true;
      }
    }
  }

  removerPatch(id) {
    this.patches = this.patches.filter((item) => item.Id !== id);
  }

  handleDesfazerAlteracoes() {
    try {
      console.log("Desfazendo alterações");
      const idx = this.parcelasOriginais.findIndex(
        (item) => this.parcelaSelecionada.Id === item.Id
      );
      console.log('idx' + idx);
      if (idx < 0) return;

      //calcular o valor dos rateios e comparar com valor da parcela, retornando erro se não for igual
      let rateios = JSON.parse(JSON.stringify(this.parcelaSelecionada.Rateio_Previsao_de_Receita__r));
      let somaRateios = 0;
      if(Array.isArray(rateios)){
        if(rateios.length > 0){
          somaRateios = rateios.reduce((acumulador, item) => acumulador + parseFloat(item.Valor__c), 0);
        }
      }      
      const info = this._wiredObjectInfo.data;

      for (const field of Object.keys(info.fields)) {
        const fieldName = info.fields[field].apiName;

        if (
          Object.prototype.hasOwnProperty.call(
            this.parcelaSelecionada,
            fieldName
          )
        ) {
          // console.log(
          //   `${fieldName} :: ${this.parcelasOriginais[idx][fieldName]} => ${this.parcelaSelecionada[fieldName]}`
          // );
          this.setParcelaFieldValue(
            this.parcelaSelecionada,
            fieldName,
            this.parcelasOriginais[idx][fieldName]
          );
        }
      }
      if(somaRateios === this.parcelaSelecionada.Valor__c){
        console.log('soma dos rateios ok, limpando parcela...');
        this.parcelaSelecionada.isDirty = false;
        this.removerPatch(this.parcelaSelecionada.Id);
        this.parcelaSelecionada.deuErro = false;
      } else {
        this.parcelaSelecionada.deuErro = true;
        this.parcelaSelecionada.mensagemDeErro = 
          'Não é possível desfazer os valores de rateio, certifique-se de ajustar manualmente. A soma dos rateios (' +
          somaRateios +
          ') não é igual ao valor do item de previsão (' +
          this.parcelaSelecionada.Valor__c +
          ').';
      }
    }
    catch (err) {
      console.log(err);
    }
  }

  async handleSalvarParcela() {
    this.salvarPatches();
    const dadosFormulario = JSON.parse(JSON.stringify(this.parcelas[this.parcelaSelecionadaIdx]));
    const sObject = { sobjectType: "Item_Previsao_Receita__c" };
    sObject.Id = dadosFormulario.Id;
    sObject.Valor__c = parseFloat(dadosFormulario.Valor__c);
    sObject.Data__c = dadosFormulario.Data__c;
    sObject.Observacao__c = dadosFormulario.Observacao__c;
    sObject.Recebido__c = dadosFormulario.Recebido__c;
    sObject.Realizado__c = dadosFormulario.Realizado__c;
    sObject.Centro_Custo__c = dadosFormulario.Centro_Custo__c;
    sObject.Data_do_recebimento_informada__c =
      dadosFormulario.Data_do_recebimento_informada__c;
    sObject.REIDI__c = dadosFormulario.REIDI__c;
    sObject.Percentual_de_REIDI__c = parseFloat(
      dadosFormulario.Percentual_de_REIDI__c
    );
    sObject.Retencao_contratual__c = dadosFormulario.Retencao_contratual__c;
    sObject.Percentual_de_retencao__c = parseFloat(
      dadosFormulario.Percentual_de_retencao__c
    );
    sObject.Previsao_de_recebimento_da_retencao__c =
      dadosFormulario.Previsao_de_recebimento_da_retencao__c;
    sObject.Retencao_recebida__c = dadosFormulario.Retencao_recebida__c;

    this.isLoading = true;
    const deuErro = false;
    try {
        //console.log('atualizando parcela...');
        await atualizarParcela({ parcela: sObject });  
    } catch (err) {
      deuErro = true;
      let message = "Não foi possível salvar a parcela";

      if (err.body.hasOwnProperty("fieldErrors")) {
        const errors = err.body.fieldErrors;
        message = Object.keys(errors)
          .reduce((errorList, item) => {
            for (const itemError of errors[item]) {
              errorList.push(
                `${this.getFieldNameLabel(item)}: ${itemError.message}`
              );
            }
            return errorList;
          }, [])
          .join("\n");
      } else if (err.body.hasOwnProperty("message")) {
        message = err.body.message;
        let regex = /FIELD_CUSTOM_VALIDATION_EXCEPTION, (.+): \[\]/;
        let resultado = message.match(regex);
        if (resultado && resultado[1]) {
          message = resultado[1];
        }
      }

      Toast.show(
        {
          label: `Erro ao salvar a parcela ${this.parcelaSelecionada.Numero_parcela__c}`,
          message,
          mode: "dismissible",
          variant: "error"
        },
        this
      );
      console.log('Erro ao salvar a parcela ', this.parcelaSelecionada.Numero_parcela__c, ' ', message);
      this.parcelaSelecionada.mensagemDeErro = 'Erro ao salvar a parcela: ' + message;
      this.parcelaSelecionada.deuErro = true;
    }

    if(!deuErro){
      // console.log('removendo patches...');
      this.removerPatch(this.parcelaSelecionada.Id);
      this.parcelaSelecionada.isDirty = false;
      
      // console.log('refrescando lista de parcelas...');
      await refreshApex(this._wiredParcelas);
      Toast.show(
        {
          label: "Sucesso",
          message: `Parcela ${this.parcelaSelecionada.Numero_parcela__c} gravada com sucesso!`,
          mode: "dismissible",
          variant: "success"
        },
        this
      );
      // Avisa o LDS que a previsão de receita pode ter mudado (recalcular formulas)
      //notifyRecordUpdateAvailable([{ recordId: this.recordId }]);
      this.parcelaSelecionada.deuErro = false;  
    }
    this.isLoading = false;
  }
  
  async handleNovaParcela() {
    try {
      this.isLoading = true;
      this.salvarPatches();
      await adicionarParcela({ previsaoReceitaId: this.recordId });
      refreshApex(this._wiredParcelas);
    } catch (err) {
      Toast.show(
        {
          label: `Erro ao gerar nova parcela`,
          message: err,
          mode: "dismissible",
          variant: "error"
        },
        this
      );
    }
  }

  async handleRemoverParcela() {
    const result = await LightningConfirm.open({
      message: `Confirma a exclusão da parcela ${this.parcelaSelecionada.Numero_parcela__c}?`,
      variant: "headerless",
      label: "Confirma?"
    });
    if (!result) return;

    try {
      this.isLoading = true;
      await removerParcela({
        itemPrevisaoReceitaId: this.parcelaSelecionada.Id
      });
      this.removerPatch(this.parcelaSelecionada.Id);
      this.parcelaSelecionada = null;
      this.parcelaSelecionadaIdx = null;
      this.salvarPatches();
      await refreshApex(this._wiredParcelas);
      Toast.show(
        {
          label: "Sucesso",
          message: `Parcela removida com sucesso!`,
          mode: "dismissible",
          variant: "success"
        },
        this
      );
    } catch (err) {
      Toast.show(
        {
          label: `Erro ao excluir parcela`,
          message: err.body,
          mode: "dismissible",
          variant: "error"
        },
        this
      );
      this.isLoading = false;
    }
  }

  handleFormChangeValue(event) { 
    if(this.timeout !== undefined) {
      clearTimeout(this.timeout);
    }

    const fieldName = event.target.name;
    let valorField = event.target.value;
    this.timeout = setTimeout(() => {
      if (this.parcelaSelecionadaIdx == null) return;
        
      if(fieldName === 'Valor__c') {
        valorField = parseFloat(valorField);
        // console.log('valorField em float: ', valorField);
      }
      let parcela = this.parcelas[this.parcelaSelecionadaIdx];
      this.setParcelaFieldValue(parcela, fieldName, valorField, true);
    }, 300);    
  }

  _handleSelecionarParcelaByIndex(index) {
    // console.log("Selecionando parcela: ", this.parcelas[index].Id);
    this.parcelaSelecionada = this.parcelas[index];
    this.parcelaSelecionadaIdx = index;

    setTimeout(() => {
      const inputFields = this.template.querySelectorAll('.my-item-previsao-receita-form lightning-input-field');
      if (inputFields.length > 0) {
        inputFields.forEach((field) => {
          field.reset();
          field.value = this.parcelaSelecionada[field.fieldName];
        });
      }
    }, 0);
  }

  handleSelecionarParcela(event) {
    const index = event.currentTarget.dataset.index;
    this._handleSelecionarParcelaByIndex(index);
  }

  setParcelaFieldValue(parcela, fieldName, value, recalcularSaldo = true) {
    
    let valor = value;
    
    // se mudou o campo, sujar parcela
    if (!parcela.isDirty) {
      if (parcela[fieldName] !== valor) parcela.isDirty = true;
    }

    // Como 0 é false em javascript...
    if (typeof valor === "number") {
      parcela[fieldName] = valor;
    } else {
      parcela[fieldName] = valor ? valor : null;
    }

    if (recalcularSaldo) {
      if (fieldName === "Valor__c") {
        this.recalcularTotal();
        // Atualiza o percentual
        if (parcela.Id === this.parcelaSelecionada.Id) {

          const total = getFieldValue(this.record.data, VALOR_TOTAL_RECEITAS_FIELD);

          if (total > 0) {
            let novoValorPercentual = ((100 * parseFloat(parcela.Valor__c)) / total).toFixed(2);
            this.percentual = novoValorPercentual;
          } else {
            // console.log('o total não é maior que 0');
            this.percentual = 0;
          }

        }
      }
    }
  }

  async handleReparcelar() {
    const qtdeParcelas = this.parcelas.length;
    if (qtdeParcelas === 0) return;

    const parcelaValor =
      getFieldValue(this.record.data, VALOR_TOTAL_RECEITAS_FIELD) /
      qtdeParcelas;
    const prompt = `Confirma o recálculo da previsão em ${qtdeParcelas} parcelas de R$ ${parcelaValor.toFixed(2)}?`;
    const result = await LightningConfirm.open({
      message: prompt,
      variant: "headerless",
      label: prompt
      // setting theme would have no effect
    });
    if (result) {
      for (const parcela of this.parcelas) {
        this.setParcelaFieldValue(
          parcela,
          "Valor__c",
          parseFloat(parcelaValor.toFixed(2)),
          false
        );
      }

      this.recalcularTotal();
    }
  }

  /**
   * Coloca o valor da parcela selecionada como o total da previsão de receita
   */
  handleSetValorTotal() {
    this.setParcelaFieldValue(
      this.parcelaSelecionada,
      "Valor__c",
      getFieldValue(this.record.data, VALOR_TOTAL_RECEITAS_FIELD)
    );
  }

  /**
   * Coloca o valor da parcela selecionada como o restante
   */
  handleSetValorSaldo() {
    // console.log(this.saldoTotalCalculado, this.parcelaSelecionada.Valor__c);
    let saldoTotal = parseFloat(this.saldoTotalCalculado);
    let valorParcela = parseFloat(this.parcelaSelecionada.Valor__c);
    let saldoFinal = (saldoTotal + valorParcela).toFixed(2);
    // console.log('saldo final: ', saldoFinal);
    let parcela = this.parcelaSelecionada;
    this.setParcelaFieldValue(
      parcela,
      "Valor__c",
      saldoFinal
    );
  }

  handlePercentualChange(event) {
    this.percentual = event.target.value;
  }

  handleSetValorPercentual() {
    const valor =
      getFieldValue(this.record.data, VALOR_TOTAL_RECEITAS_FIELD) *
      (this.percentual / 100.0);
    this.setParcelaFieldValue(this.parcelaSelecionada, "Valor__c", valor);
  }

  async handleRefresh(event) {
    this.isLoading = true;
    this.salvarPatches();
    try {
      await refreshApex(this._wiredParcelas);
    } finally {
        if (!this.parcelaSelecionada) {
          // console.log('Não há parcela selecionada');
        }
        else {
          // console.log('rateios por parcela: ', this.rateiosOriginaisPorParcela);
          this.rateiosOriginais = this.rateiosOriginaisPorParcela[this.parcelaSelecionada.Id];
        }
        // console.log('rateios originais', this.rateiosOriginais);
        // detecta mudanças na lista de rateios a fim de sujar a parcela
        if(Array.isArray(this.rateiosOriginais)){
          if(this.rateiosParcelaSelecionada.length != this.rateiosOriginais.length){
            // console.log(this.parcelaSelecionada.Id);
            this.sujarParcela(this.parcelaSelecionada.Id);
          }
          else if(this.rateiosParcelaSelecionada.length > 0) {
            const mapaRateiosOriginais = {};
            // console.log('rateiosparcelaselecionada > 0');
            this.rateiosOriginais.forEach(rateio => {
              mapaRateiosOriginais[rateio.Id] = rateio;
            });
            const houveMudanca = this.rateiosParcelaSelecionada.some(rateio => {
              const rateioOriginal = mapaRateiosOriginais[rateio.Id];
              return rateio.Valor__c !== rateioOriginal.Valor__c;
            });
            // console.log('houve mudança: ', houveMudanca);
            if (houveMudanca) {
              this.sujarParcela(this.parcelaSelecionada.Id);
            }
          }
        } else {
          if(this.rateiosParcelaSelecionada.length > 0){
            //foi criado rateios
            this.sujarParcela(this.parcelaSelecionada.Id);
          }
        }
        
      this.isLoading = false;
    }
  }

  sujarParcela(parcelaId){
    this.parcelas.forEach(parcela => {
      if(parcela.Id == parcelaId){
        parcela.isDirty = true;
      }
    })
    this.salvarPatches();
  }

  get rateiosParcelaSelecionada() {
    if (!this.parcelaSelecionada) return [];
    if (this.parcelaSelecionada.Rateio_Previsao_de_Receita__r)
      return this.parcelaSelecionada.Rateio_Previsao_de_Receita__r;
    return [];
  } 

  get layoutItemClass() {
    return this.isCollapsed ? 'slds-hide' : '';
  }

  get layoutClass() {
    return this.isCollapsed ? 'container-principal' : 'container-principal com-grid';
  }

  toggleCollapse() {
    this.isCollapsed = !this.isCollapsed;
  }

  handleSetLoading() {
    this.isLoading = true;
  }
  
  handleClearLoading() {
    this.isLoading = false;
  }

  handleRatear() {
    PrevisaoReceitasParcelamentoRateios.open({
      rateios: this.rateiosParcelaSelecionada,
      itemPrevisaoReceitaId: this.parcelaSelecionada.Id,
      valorParcela: this.parcelaSelecionada.Valor__c,
      onatualizado: this.handleRefresh,
      onsetloading: () => {},
      onclearloading: () => {}
    }).then((_) => this.handleRefresh());
  }

  async handleNovaVersao() {
    try {
      const result = await LightningPrompt.open({
        message: "Qual o motivo para a criação da nova versão?",
        //theme defaults to "default"
        label: "Gerar nova versão da previsão de receitas",
        defaultValue: "Nova versão"
      });
      if (result) {
        this.isLoading = true;
        const novaVersaoId = await gerarNovaVersao({
          previsaoReceita: this.recordId,
          motivo: result
        });
        this[NavigationMixin.Navigate]({
          type: "standard__recordPage",
          attributes: {
            recordId: novaVersaoId,
            objectApiName: "Previsao_Receita__c",
            actionName: "view"
          }
        });
      }
    } catch (err) {
      Toast.show(
        {
          label: `Erro ao gerar nova versão`,
          message: err.body,
          mode: "dismissible",
          variant: "error"
        },
        this
      );
      this.isLoading = false;
    }
  }

}