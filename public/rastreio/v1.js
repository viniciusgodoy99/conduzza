/*
 * Conduzza: rastreio do clique de anuncio do Google no site da clinica (v1).
 * Uso: <script src="https://<sistema>/rastreio/v1.js" data-chave="<chave>"
 *        referrerpolicy="no-referrer" async></script>
 * So age em visita vinda de anuncio do Google. No clique do link do WhatsApp,
 * acrescenta um codigo ao texto (" [#K7Q2MX]") e avisa o sistema. Nunca
 * impede o link, nunca guarda IP, pagina ou dado de quem visita.
 * Regras espelhadas em lib/domain/rastreio-do-site.ts (o teste confere).
 */
/* eslint-disable @typescript-eslint/no-unused-vars -- catch (e) em vez de
   catch {}: navegador antigo nao entende o catch sem variavel. */
(function () {
  "use strict";
  try {
    var ALFABETO = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
    var TEXTO_PADRAO = "Ol\u00e1!";
    var ID = /^[A-Za-z0-9._~+\/=-]{1,512}$/;
    var NUMERO = /^[0-9]{1,20}$/;
    var FORMATOS = {
      gclid: ID,
      gbraid: ID,
      wbraid: ID,
      gad_source: /^[A-Za-z0-9_-]{1,32}$/,
      gad_campaignid: NUMERO,
      cz_campanha: NUMERO,
      cz_grupo: NUMERO,
    };
    var LINK =
      /^(?:(?:https?:)?\/\/(?:www\.)?(?:wa\.me\/\d*|api\.whatsapp\.com\/send|web\.whatsapp\.com\/send)|whatsapp:\/\/send)\/?(?=[?#]|$)/i;
    var CODIGO_NO_TEXTO = /#[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}/i;

    var script =
      document.currentScript ||
      document.querySelector('script[data-chave][src*="/rastreio/v1.js"]');
    if (!script) return;
    var chave = script.getAttribute("data-chave") || "";
    if (!/^[0-9a-f]{20}$/.test(chave)) return;
    // O sinal guardado e da chave: duas clinicas no mesmo site (mesma origem,
    // mesma aba) nunca levam o anuncio uma da outra.
    var GUARDADO = "conduzza_rastreio_v1_" + chave;
    var destino = new URL("/api/publico/clique", script.src).href;

    var filtrar = function (ler) {
      var sinais = {};
      var algum = false;
      for (var nome in FORMATOS) {
        var valor = ler(nome);
        if (typeof valor === "string" && FORMATOS[nome].test(valor)) {
          sinais[nome] = valor;
          algum = true;
        }
      }
      return algum ? sinais : null;
    };

    var busca = new URLSearchParams(window.location.search);
    var sinais = filtrar(function (nome) {
      return busca.get(nome);
    });
    if (sinais) {
      try {
        window.sessionStorage.setItem(GUARDADO, JSON.stringify(sinais));
      } catch (e) {}
    } else {
      try {
        var texto = window.sessionStorage.getItem(GUARDADO);
        var guardado = JSON.parse(texto || "null");
        if (guardado && typeof guardado === "object") {
          sinais = filtrar(function (nome) {
            return Object.prototype.hasOwnProperty.call(guardado, nome)
              ? guardado[nome]
              : null;
          });
        }
      } catch (e) {}
    }
    // Sem sinal do Google: nada de ouvinte, nada de aviso.
    if (!sinais) return;

    var gerarCodigo = function () {
      var codigo = "";
      var bytes = new Uint8Array(16);
      while (codigo.length < 6) {
        window.crypto.getRandomValues(bytes);
        for (var i = 0; i < bytes.length && codigo.length < 6; i++) {
          // 248 = 31 * 8: descarta o resto para nao viciar o sorteio.
          if (bytes[i] < 248) codigo += ALFABETO.charAt(bytes[i] % 31);
        }
      }
      return codigo;
    };

    var decodificar = function (valor) {
      try {
        return decodeURIComponent(valor.replace(/\+/g, " "));
      } catch (e) {
        return null;
      }
    };

    // O texto da clinica fica como estava: o sufixo vai colado no valor bruto.
    var comCodigo = function (href, codigo) {
      href = href.trim();
      var inicio = LINK.exec(href);
      if (!inicio) return null;
      var base = inicio[0];
      var cauda = href.slice(base.length);
      var posHash = cauda.indexOf("#");
      var hash = posHash >= 0 ? cauda.slice(posHash) : "";
      var query = posHash >= 0 ? cauda.slice(0, posHash) : cauda;
      var partes = query.length > 1 ? query.slice(1).split("&") : [];
      var sufixo = " [#" + codigo + "]";
      var textoNovo = "text=" + encodeURIComponent(TEXTO_PADRAO + sufixo);
      var achou = false;
      for (var i = 0; i < partes.length; i++) {
        var igual = partes[i].indexOf("=");
        var nome = igual >= 0 ? partes[i].slice(0, igual) : partes[i];
        if (decodificar(nome) !== "text") continue;
        var bruto = igual >= 0 ? partes[i].slice(igual + 1) : "";
        var texto = decodificar(bruto);
        if (texto === null || CODIGO_NO_TEXTO.test(texto)) return null;
        partes[i] =
          texto.trim() === ""
            ? textoNovo
            : nome + "=" + bruto + encodeURIComponent(sufixo);
        achou = true;
        break;
      }
      if (!achou) partes.push(textoNovo);
      return base + "?" + partes.join("&") + hash;
    };

    var avisar = function (codigo) {
      var corpo = { chave: chave, codigo: codigo };
      for (var nome in sinais) {
        if (Object.prototype.hasOwnProperty.call(sinais, nome))
          corpo[nome] = sinais[nome];
      }
      var texto = JSON.stringify(corpo);
      try {
        if (navigator.sendBeacon && navigator.sendBeacon(destino, texto))
          return;
      } catch (e) {}
      try {
        fetch(destino, {
          method: "POST",
          body: texto,
          mode: "no-cors",
          credentials: "omit",
          keepalive: true,
        }).catch(function () {});
      } catch (e) {}
    };

    var acharLink = function (evento) {
      var caminho =
        typeof evento.composedPath === "function" ? evento.composedPath() : [];
      if (!caminho.length) {
        for (var no = evento.target; no; no = no.parentNode) caminho.push(no);
      }
      for (var i = 0; i < caminho.length; i++) {
        var el = caminho[i];
        if (
          el &&
          typeof el.tagName === "string" &&
          el.tagName.toUpperCase() === "A" &&
          typeof el.getAttribute === "function" &&
          el.getAttribute("href")
        ) {
          return el;
        }
      }
      return null;
    };

    var aplicados = typeof WeakMap === "function" ? new WeakMap() : null;

    var aoClicar = function (evento) {
      try {
        if (evento.type === "auxclick" && evento.button !== 1) return;
        var link = acharLink(evento);
        if (!link) return;
        var atual = link.getAttribute("href");
        var anterior = aplicados && aplicados.get(link);
        var original =
          anterior && anterior.aplicado === atual ? anterior.original : atual;
        var codigo = gerarCodigo();
        var novo = comCodigo(original, codigo);
        if (!novo) return;
        link.setAttribute("href", novo);
        if (aplicados)
          aplicados.set(link, { original: original, aplicado: novo });
        avisar(codigo);
        // Devolve o link original depois: copiar o endereco nao leva o codigo.
        setTimeout(function () {
          try {
            if (link.getAttribute("href") === novo)
              link.setAttribute("href", original);
          } catch (e) {}
        }, 1500);
      } catch (e) {}
    };

    document.addEventListener("click", aoClicar, true);
    document.addEventListener("auxclick", aoClicar, true);
  } catch (e) {}
})();
