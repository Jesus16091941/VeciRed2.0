/*
 * INT-08 - Editar Perfil Profesional.
 * Carga y edición del perfil del profesional autenticado contra FastAPI (Railway).
 * Depende de window.VeciRed (vecired.js), que debe cargarse antes que este archivo.
 *
 * Contrato del backend (backend/main.py):
 *   GET  /profesionales/me/perfil   -> perfil del usuario dueño del token
 *   PUT  /profesionales/me/perfil   -> guarda los campos editables y devuelve el perfil actualizado
 *   Ambas rutas reciben "Authorization: Bearer <token>" y nunca un id de usuario en la URL.
 */
(function () {
  'use strict';

  var API_BASE = 'https://vecired20-production.up.railway.app';
  var PERFIL_PATH = '/profesionales/me/perfil';
  var RADIOS_PERMITIDOS = [3, 5, 8, 10];
  var LIMITES = { alias: 100, descripcion: 600, etiqueta: 40, etiquetas: 15, tarifaMax: 5000000 };
  var ESTADOS_VERIFICADOS = ['verificado', 'validado', 'aprobado'];

  var VR = window.VeciRed;
  if (!VR) return;

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    estadoSync: $('estado-sincronizacion'),
    estadoSyncIcono: $('estado-sincronizacion-icono'),
    avisoCuenta: $('aviso-cuenta'),
    selloHeader: $('sello-verificado'),
    selloAvatar: $('sello-avatar'),
    nombreLegal: $('nombre-legal'),
    alias: $('alias-input'),
    especialidad: $('specialty-select'),
    descripcion: $('bio-input'),
    contador: $('char-counter'),
    tarifaVisita: $('tarifa-visita'),
    tarifaUrgencia: $('tarifa-urgencia'),
    certificaciones: $('lista-certificaciones'),
    tags: $('tags-container'),
    tagInput: $('tag-input'),
    tagAgregar: $('tag-agregar'),
    mostrarWhatsapp: $('pref-whatsapp'),
    mostrarCorreo: $('pref-correo'),
    alertasUrgencia: $('pref-urgencias'),
    origenPreferencias: $('origen-preferencias'),
    radios: $('selector-radio'),
    radarExterior: $('radar-label-exterior'),
    radarMedio: $('radar-label-medio'),
    radarInterior: $('radar-label-interior'),
    alcanceRadio: $('alcance-radio'),
    centroOperaciones: $('centro-operaciones'),
    verificacionIdentidad: $('estado-verificacion-identidad'),
    ultimaSync: $('ultima-sincronizacion'),
    errores: $('errores-formulario'),
    modalVista: $('modalVistaPrevia')
  };

  var estado = {
    modo: 'none',
    snapshot: null,
    etiquetas: [],
    radio: null,
    cargadoDesdeServidor: false,
    guardando: false
  };

  /* ---------- Sesión y autenticación ---------- */

  function usuarioActual() { return VR.users.current(); }

  // Las cuentas de demostración viven solo en este navegador y nunca deben consultar Railway.
  function modoCuenta(u) {
    if (!u) return 'none';
    if (u.rol !== 'tech') return 'not-tech';
    var id = String(u.id == null ? '' : u.id);
    if (u.demo || id.indexOf('seed-') === 0) return 'demo';
    if (/^\d+$/.test(id)) return 'railway';
    return 'local';
  }

  // FastAPI emite el token en POST /login; vecired.js lo guarda solo en sessionStorage ("vecired:token").
  function tokenSesion() {
    var t = VR.store.get('token');
    return typeof t === 'string' && t.length > 0 ? t : null;
  }

  function solicitudPerfil(method, body) {
    var token = tokenSesion();
    if (!token) return Promise.reject({ tipo: 'sin-token' });
    var opciones = {
      method: method,
      headers: { 'Accept': 'application/json', 'Authorization': 'Bearer ' + token },
      cache: 'no-store'
    };
    if (body) {
      opciones.headers['Content-Type'] = 'application/json';
      opciones.body = JSON.stringify(body);
    }
    return fetch(API_BASE + PERFIL_PATH, opciones).then(function (res) {
      if (res.status === 401 || res.status === 403) throw { tipo: 'no-autorizado', status: res.status };
      if (res.status === 404 || res.status === 405 || res.status === 501) throw { tipo: 'sin-endpoint', status: res.status };
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok) throw { tipo: 'servidor', status: res.status, detalle: data && data.detail };
        if (!data || typeof data !== 'object') throw { tipo: 'respuesta-invalida', status: res.status };
        return data;
      });
    }, function () { throw { tipo: 'red' }; });
  }

  /* ---------- Normalización de datos ---------- */

  function aBool(v, porDefecto) {
    if (v === undefined || v === null) return porDefecto;
    return v === true || v === 1 || v === '1';
  }

  function aEntero(v) {
    if (v === undefined || v === null || v === '') return null;
    var n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  function perfilVacio() {
    return {
      nombre_legal: '',
      nombre_publico: '',
      especialidad: '',
      descripcion: '',
      tarifa_visita: null,
      tarifa_urgencia: null,
      radio_cobertura_km: null,
      etiquetas: [],
      certificaciones: [],
      // Valores por defecto de las tablas privacidad_profesional y notificaciones_profesional.
      mostrar_whatsapp: false,
      ocultar_correo: true,
      alertas_urgencia: false,
      estado_verificacion: null,
      barrio: ''
    };
  }

  function perfilDesdeServidor(data) {
    var p = perfilVacio();
    var priv = data.privacidad || {};
    var notif = data.notificaciones || {};
    p.nombre_legal = data.nombre_legal || data.nombre || '';
    p.nombre_publico = data.nombre_publico || '';
    p.especialidad = data.especialidad || '';
    p.descripcion = data.descripcion || '';
    p.tarifa_visita = aEntero(data.tarifa_visita);
    p.tarifa_urgencia = aEntero(data.tarifa_urgencia);
    var radio = aEntero(data.radio_cobertura_km);
    p.radio_cobertura_km = RADIOS_PERMITIDOS.indexOf(radio) !== -1 ? radio : null;
    p.etiquetas = (Array.isArray(data.etiquetas) ? data.etiquetas : [])
      .map(function (t) { return typeof t === 'string' ? t : (t && t.etiqueta) || ''; })
      .filter(Boolean);
    // Solo campos públicos de la certificación: nada de RUT, referencias ni rutas de archivos.
    p.certificaciones = (Array.isArray(data.certificaciones) ? data.certificaciones : []).map(function (c) {
      return {
        nombre: (c && c.nombre) || '',
        institucion: (c && c.institucion) || '',
        estado: ['pendiente', 'validado', 'rechazado'].indexOf(c && c.estado) !== -1 ? c.estado : 'pendiente',
        fecha_vencimiento: (c && c.fecha_vencimiento) || ''
      };
    }).filter(function (c) { return c.nombre; });
    p.mostrar_whatsapp = aBool(priv.mostrar_whatsapp, false);
    p.ocultar_correo = aBool(priv.ocultar_correo, true);
    p.alertas_urgencia = aBool(notif.alertas_urgencia, false);
    p.estado_verificacion = data.estado_verificacion || null;
    p.barrio = data.barrio || '';
    return p;
  }

  // Sin perfil del servidor solo se usan los datos básicos que ya trae la sesión.
  function perfilDesdeSesion(u) {
    var p = perfilVacio();
    p.nombre_legal = u.nombre || '';
    p.nombre_publico = u.aliasPublico || '';
    p.especialidad = (u.verificacion && u.verificacion.especialidad) || (u.oficios && u.oficios[0]) || '';
    p.barrio = u.barrio || '';
    // El estado de verificación del login proviene de perfiles_profesional; el de las demos es local y no cuenta.
    p.estado_verificacion = estado.modo === 'railway' && u.verificacion ? u.verificacion.estado || null : null;
    return p;
  }

  /* ---------- Formato ---------- */

  function formatoCLP(n) {
    return n == null ? '' : n.toLocaleString('es-CL');
  }

  function leerCLP(input) {
    var digitos = String(input.value || '').replace(/[^\d]/g, '');
    return digitos ? Number(digitos) : null;
  }

  function formatoKm(n) {
    return n.toLocaleString('es-CL', { maximumFractionDigits: 1 }) + ' km';
  }

  function horaActual() {
    return new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  }

  /* ---------- Estado visual ---------- */

  function mostrarEstado(texto, tono) {
    if (!el.estadoSync) return;
    el.estadoSync.textContent = texto;
    var contenedor = el.estadoSync.parentElement;
    contenedor.classList.remove('text-secondary', 'text-error', 'text-on-surface-variant');
    contenedor.classList.add(tono === 'ok' ? 'text-secondary' : tono === 'error' ? 'text-error' : 'text-on-surface-variant');
    if (el.estadoSyncIcono) {
      el.estadoSyncIcono.textContent = tono === 'ok' ? 'cloud_done' : tono === 'error' ? 'cloud_off' : 'cloud_sync';
    }
  }

  function mostrarAviso(texto) {
    if (!el.avisoCuenta) return;
    el.avisoCuenta.hidden = !texto;
    var cuerpo = el.avisoCuenta.querySelector('[data-aviso-texto]');
    if (cuerpo) cuerpo.textContent = texto || '';
  }

  function textoEstadoVerificacion(valor) {
    if (!valor) return 'Pendiente de configuración';
    var v = String(valor).toLowerCase();
    if (ESTADOS_VERIFICADOS.indexOf(v) !== -1) return 'Aprobado';
    if (v === 'rechazado') return 'Rechazado';
    return 'Pendiente de revisión';
  }

  function aplicarVerificacion(p) {
    var verificado = !!p.estado_verificacion && ESTADOS_VERIFICADOS.indexOf(String(p.estado_verificacion).toLowerCase()) !== -1;
    if (el.selloHeader) el.selloHeader.hidden = !verificado;
    if (el.selloAvatar) el.selloAvatar.hidden = !verificado;
    if (el.verificacionIdentidad) el.verificacionIdentidad.textContent = textoEstadoVerificacion(p.estado_verificacion);
  }

  /* ---------- Render del formulario ---------- */

  function seleccionarEspecialidad(valor) {
    var select = el.especialidad;
    if (!select) return;
    Array.prototype.slice.call(select.querySelectorAll('option[data-dinamica]')).forEach(function (o) { o.remove(); });
    if (!valor) { select.value = ''; return; }
    var objetivo = valor.trim().toLowerCase();
    var coincide = Array.prototype.find.call(select.options, function (o) {
      var texto = String(o.value || o.text).trim().toLowerCase();
      return texto === objetivo || (texto.indexOf(objetivo) === 0 && /[\s,\/&]/.test(texto.charAt(objetivo.length)));
    });
    if (!coincide) {
      coincide = new Option(valor, valor);
      coincide.setAttribute('data-dinamica', '');
      select.add(coincide);
    }
    select.value = coincide.value;
  }

  function actualizarContador() {
    if (!el.descripcion || !el.contador) return;
    var len = el.descripcion.value.length;
    el.contador.textContent = len + ' / ' + LIMITES.descripcion + ' caracteres';
    el.contador.classList.toggle('text-error', len > LIMITES.descripcion - 50);
    el.contador.classList.toggle('text-on-surface-variant', len <= LIMITES.descripcion - 50);
  }

  function renderEtiquetas() {
    if (!el.tags) return;
    el.tags.textContent = '';
    if (!estado.etiquetas.length) {
      var vacio = document.createElement('span');
      vacio.className = 'font-body-sm text-body-sm text-on-surface-variant';
      vacio.textContent = 'Aún no has agregado especialidades.';
      el.tags.appendChild(vacio);
      return;
    }
    estado.etiquetas.forEach(function (texto, i) {
      var chip = document.createElement('span');
      chip.className = 'inline-flex items-center gap-space-xs bg-surface-container text-on-surface px-space-sm py-1.5 rounded-full font-label-md text-label-md transition-colors hover:bg-surface-container-high';
      var etiqueta = document.createElement('span');
      etiqueta.textContent = texto;
      var quitar = document.createElement('button');
      quitar.type = 'button';
      quitar.className = 'text-outline hover:text-error flex items-center';
      quitar.setAttribute('aria-label', 'Quitar especialidad ' + texto);
      quitar.innerHTML = '<span class="material-symbols-outlined text-[15px]" aria-hidden="true">close</span>';
      quitar.addEventListener('click', function () {
        estado.etiquetas.splice(i, 1);
        renderEtiquetas();
        marcarCambios();
      });
      chip.appendChild(etiqueta);
      chip.appendChild(quitar);
      el.tags.appendChild(chip);
    });
  }

  function agregarEtiqueta() {
    var texto = (el.tagInput.value || '').trim().replace(/\s+/g, ' ');
    if (!texto) return;
    if (texto.length > LIMITES.etiqueta) {
      VR.toast('Cada especialidad puede tener hasta ' + LIMITES.etiqueta + ' caracteres.');
      return;
    }
    if (estado.etiquetas.length >= LIMITES.etiquetas) {
      VR.toast('Puedes registrar hasta ' + LIMITES.etiquetas + ' especialidades.');
      return;
    }
    var repetida = estado.etiquetas.some(function (t) { return t.toLowerCase() === texto.toLowerCase(); });
    if (repetida) {
      VR.toast('Esa especialidad ya está en tu perfil.');
      return;
    }
    estado.etiquetas.push(texto);
    el.tagInput.value = '';
    renderEtiquetas();
    marcarCambios();
  }

  var CLASES_ESTADO_CERT = {
    validado: { texto: 'Validado', clase: 'text-secondary bg-secondary-container/20', icono: 'verified' },
    pendiente: { texto: 'Pendiente', clase: 'text-on-surface-variant bg-surface-container', icono: 'schedule' },
    rechazado: { texto: 'Rechazado', clase: 'text-error bg-error-container/60', icono: 'cancel' }
  };

  function renderCertificaciones(lista) {
    if (!el.certificaciones) return;
    el.certificaciones.textContent = '';
    if (!lista.length) {
      var vacio = document.createElement('p');
      vacio.className = 'font-body-sm text-body-sm text-on-surface-variant p-space-sm bg-surface-container-low rounded-lg';
      vacio.textContent = 'Sin certificaciones registradas.';
      el.certificaciones.appendChild(vacio);
      return;
    }
    lista.forEach(function (c) {
      var info = CLASES_ESTADO_CERT[c.estado] || CLASES_ESTADO_CERT.pendiente;
      var item = document.createElement('li');
      item.className = 'flex items-center justify-between gap-space-sm p-space-sm bg-surface-container-low rounded-lg';
      var izquierda = document.createElement('div');
      izquierda.className = 'flex items-start gap-space-xs min-w-0';
      izquierda.innerHTML = '<span class="material-symbols-outlined text-secondary text-[20px]" aria-hidden="true">workspace_premium</span>';
      var textos = document.createElement('div');
      textos.className = 'flex flex-col min-w-0';
      var nombre = document.createElement('span');
      nombre.className = 'font-body-md text-body-md text-primary font-medium truncate';
      nombre.textContent = c.nombre;
      textos.appendChild(nombre);
      var detalle = [c.institucion, c.fecha_vencimiento ? 'Vence: ' + c.fecha_vencimiento : ''].filter(Boolean).join(' · ');
      if (detalle) {
        var sub = document.createElement('span');
        sub.className = 'font-body-sm text-body-sm text-on-surface-variant truncate';
        sub.textContent = detalle;
        textos.appendChild(sub);
      }
      izquierda.appendChild(textos);
      var chip = document.createElement('span');
      chip.className = 'shrink-0 inline-flex items-center gap-1 font-label-sm text-label-sm px-2 py-0.5 rounded font-bold ' + info.clase;
      chip.innerHTML = '<span class="material-symbols-outlined text-[13px]" aria-hidden="true">' + info.icono + '</span>';
      chip.appendChild(document.createTextNode(info.texto));
      item.appendChild(izquierda);
      item.appendChild(chip);
      el.certificaciones.appendChild(item);
    });
  }

  function aplicarRadio(km) {
    estado.radio = RADIOS_PERMITIDOS.indexOf(km) !== -1 ? km : null;
    if (el.radios) {
      Array.prototype.forEach.call(el.radios.querySelectorAll('[data-radio-km]'), function (btn) {
        var activo = Number(btn.getAttribute('data-radio-km')) === estado.radio;
        btn.setAttribute('aria-checked', activo ? 'true' : 'false');
        btn.tabIndex = activo || (estado.radio === null && btn === el.radios.querySelector('[data-radio-km]')) ? 0 : -1;
        btn.classList.toggle('bg-primary', activo);
        btn.classList.toggle('text-on-primary', activo);
        btn.classList.toggle('font-bold', activo);
        btn.classList.toggle('shadow-sm', activo);
        btn.classList.toggle('text-on-surface', !activo);
        btn.classList.toggle('hover:bg-surface-container-highest', !activo);
      });
    }
    var r = estado.radio;
    if (el.radarExterior) el.radarExterior.textContent = r ? formatoKm(r) + ' (Límite Máx.)' : 'Radio no especificado';
    if (el.radarMedio) el.radarMedio.textContent = r ? formatoKm(r * 0.66) : '';
    if (el.radarInterior) el.radarInterior.textContent = r ? formatoKm(r * 0.33) : '';
    if (el.alcanceRadio) el.alcanceRadio.textContent = r ? formatoKm(r) : 'tu radio (no especificado)';
  }

  function rellenar(p) {
    if (el.nombreLegal) {
      el.nombreLegal.value = p.nombre_legal || 'Pendiente de completar';
      el.nombreLegal.classList.toggle('italic', !p.nombre_legal);
    }
    el.alias.value = p.nombre_publico;
    el.alias.placeholder = 'Pendiente de completar';
    seleccionarEspecialidad(p.especialidad);
    el.descripcion.value = p.descripcion;
    el.descripcion.placeholder = 'Pendiente de completar. Describe tu experiencia, garantías y zona de trabajo.';
    actualizarContador();
    el.tarifaVisita.value = formatoCLP(p.tarifa_visita);
    el.tarifaVisita.placeholder = 'No especificada';
    el.tarifaUrgencia.value = formatoCLP(p.tarifa_urgencia);
    el.tarifaUrgencia.placeholder = 'No especificada';
    estado.etiquetas = p.etiquetas.slice();
    renderEtiquetas();
    renderCertificaciones(p.certificaciones);
    el.mostrarWhatsapp.checked = p.mostrar_whatsapp;
    el.mostrarCorreo.checked = !p.ocultar_correo;
    el.alertasUrgencia.checked = p.alertas_urgencia;
    if (el.origenPreferencias) {
      el.origenPreferencias.hidden = estado.cargadoDesdeServidor;
    }
    aplicarRadio(p.radio_cobertura_km);
    if (el.centroOperaciones) el.centroOperaciones.textContent = p.barrio || 'No especificada';
    aplicarVerificacion(p);
    limpiarErrores();
  }

  /* ---------- Lectura y validación ---------- */

  function recolectar() {
    return {
      nombre_publico: el.alias.value.trim(),
      especialidad: el.especialidad.value.trim(),
      descripcion: el.descripcion.value.trim(),
      tarifa_visita: leerCLP(el.tarifaVisita),
      tarifa_urgencia: leerCLP(el.tarifaUrgencia),
      radio_cobertura_km: estado.radio,
      etiquetas: estado.etiquetas.slice(),
      privacidad: {
        mostrar_whatsapp: el.mostrarWhatsapp.checked,
        ocultar_correo: !el.mostrarCorreo.checked
      },
      notificaciones: {
        alertas_urgencia: el.alertasUrgencia.checked
      }
    };
  }

  function editablesDe(p) {
    return {
      nombre_publico: p.nombre_publico,
      especialidad: p.especialidad,
      descripcion: p.descripcion,
      tarifa_visita: p.tarifa_visita,
      tarifa_urgencia: p.tarifa_urgencia,
      radio_cobertura_km: p.radio_cobertura_km,
      etiquetas: p.etiquetas.slice(),
      privacidad: { mostrar_whatsapp: p.mostrar_whatsapp, ocultar_correo: p.ocultar_correo },
      notificaciones: { alertas_urgencia: p.alertas_urgencia }
    };
  }

  function validar(datos) {
    var errores = [];
    if (!datos.nombre_publico) errores.push({ campo: el.alias, texto: 'Ingresa tu nombre comercial o alias.' });
    else if (datos.nombre_publico.length > LIMITES.alias) errores.push({ campo: el.alias, texto: 'El alias puede tener hasta ' + LIMITES.alias + ' caracteres.' });
    if (!datos.especialidad) errores.push({ campo: el.especialidad, texto: 'Selecciona tu especialidad principal.' });
    if (datos.descripcion.length > LIMITES.descripcion) errores.push({ campo: el.descripcion, texto: 'La descripción puede tener hasta ' + LIMITES.descripcion + ' caracteres.' });
    [[datos.tarifa_visita, el.tarifaVisita, 'visita'], [datos.tarifa_urgencia, el.tarifaUrgencia, 'urgencia']].forEach(function (t) {
      if (t[0] !== null && (t[0] <= 0 || t[0] > LIMITES.tarifaMax)) {
        errores.push({ campo: t[1], texto: 'La tarifa de ' + t[2] + ' debe estar entre $1 y $' + formatoCLP(LIMITES.tarifaMax) + ' CLP.' });
      }
    });
    if (datos.radio_cobertura_km !== null && RADIOS_PERMITIDOS.indexOf(datos.radio_cobertura_km) === -1) {
      errores.push({ campo: el.radios, texto: 'El radio de cobertura debe ser 3, 5, 8 o 10 km.' });
    }
    if (datos.etiquetas.length > LIMITES.etiquetas) errores.push({ campo: el.tagInput, texto: 'Puedes registrar hasta ' + LIMITES.etiquetas + ' especialidades.' });
    return errores;
  }

  function limpiarErrores() {
    document.querySelectorAll('[data-int08-invalido]').forEach(function (campo) {
      campo.removeAttribute('aria-invalid');
      campo.removeAttribute('data-int08-invalido');
      campo.classList.remove('ring-2', 'ring-error');
    });
    if (el.errores) { el.errores.hidden = true; el.errores.textContent = ''; }
  }

  function mostrarErrores(errores) {
    limpiarErrores();
    if (!el.errores) return;
    var titulo = document.createElement('p');
    titulo.className = 'font-label-md text-label-md font-bold';
    titulo.textContent = 'Revisa los siguientes campos antes de guardar:';
    var lista = document.createElement('ul');
    lista.className = 'list-disc pl-5 font-body-sm text-body-sm';
    errores.forEach(function (e) {
      var li = document.createElement('li');
      li.textContent = e.texto;
      lista.appendChild(li);
      if (e.campo) {
        e.campo.setAttribute('aria-invalid', 'true');
        e.campo.setAttribute('data-int08-invalido', '');
        e.campo.classList.add('ring-2', 'ring-error');
      }
    });
    el.errores.appendChild(titulo);
    el.errores.appendChild(lista);
    el.errores.hidden = false;
    if (errores[0].campo && errores[0].campo.focus) errores[0].campo.focus();
  }

  function hayCambios() {
    if (!estado.snapshot) return false;
    return JSON.stringify(recolectar()) !== JSON.stringify(editablesDe(estado.snapshot));
  }

  function marcarCambios() {
    if (!estado.snapshot || estado.guardando) return;
    if (hayCambios()) mostrarEstado('Tienes cambios sin guardar', 'neutral');
    else mostrarEstado(estado.cargadoDesdeServidor ? 'Sin cambios pendientes' : 'Datos de la sesión: perfil completo pendiente del servidor', estado.cargadoDesdeServidor ? 'ok' : 'neutral');
  }

  /* ---------- Acciones ---------- */

  function bloquearGuardado(bloqueado) {
    document.querySelectorAll('[data-int08-accion="guardar"]').forEach(function (b) {
      b.disabled = bloqueado;
      b.setAttribute('aria-busy', bloqueado ? 'true' : 'false');
      b.classList.toggle('opacity-60', bloqueado);
    });
  }

  function guardar() {
    if (estado.guardando) return;
    var datos = recolectar();
    var errores = validar(datos);
    if (errores.length) {
      mostrarErrores(errores);
      mostrarEstado('Hay campos con errores', 'error');
      return;
    }
    limpiarErrores();

    if (estado.modo === 'demo' || estado.modo === 'local') {
      VR.toast('Cuenta de demostración local: los cambios no se envían a Railway.');
      mostrarEstado('No guardado: cuenta de demostración local', 'neutral');
      return;
    }
    if (estado.modo !== 'railway') {
      VR.toast('Inicia sesión como profesional para guardar tu perfil.');
      return;
    }
    if (!tokenSesion()) {
      VR.toast('No se guardó: vuelve a iniciar sesión para continuar.');
      mostrarEstado('No guardado: tu sesión necesita renovarse', 'error');
      return;
    }

    estado.guardando = true;
    bloquearGuardado(true);
    mostrarEstado('Guardando en el servidor…', 'neutral');
    solicitudPerfil('PUT', datos).then(function (data) {
      // Solo se confirma el guardado con el perfil que devuelve el servidor.
      estado.cargadoDesdeServidor = true;
      estado.snapshot = perfilDesdeServidor(data);
      rellenar(estado.snapshot);
      var hora = horaActual();
      if (el.ultimaSync) el.ultimaSync.textContent = 'Hoy ' + hora;
      mostrarEstado('Cambios guardados a las ' + hora, 'ok');
      VR.toast('Cambios guardados.');
    }).catch(function (err) {
      mostrarEstado(mensajeError(err, 'guardar'), 'error');
      VR.toast(mensajeError(err, 'guardar'));
    }).then(function () {
      estado.guardando = false;
      bloquearGuardado(false);
    });
  }

  function descartar() {
    if (!estado.snapshot) return;
    rellenar(estado.snapshot);
    marcarCambios();
    VR.toast('Se restauraron los últimos datos cargados.');
  }

  function mensajeError(err, accion) {
    var verbo = accion === 'guardar' ? 'guardar' : 'cargar';
    switch (err && err.tipo) {
      case 'sin-token': return 'No se pudo ' + verbo + ': vuelve a iniciar sesión.';
      case 'no-autorizado': return 'Tu sesión no es válida o expiró. Vuelve a iniciar sesión.';
      case 'sin-endpoint': return 'No se pudo ' + verbo + ': la ruta del perfil aún no existe en el backend.';
      case 'red': return 'No se pudo conectar con el servidor de VeciRed.';
      case 'respuesta-invalida': return 'El servidor respondió con un formato inesperado.';
      default: return (err && err.detalle) || 'El servidor no pudo ' + verbo + ' el perfil.';
    }
  }

  /* ---------- Vista previa ---------- */

  function filaVista(titulo, valor) {
    var fila = document.createElement('div');
    fila.className = 'flex flex-col gap-0.5';
    var t = document.createElement('dt');
    t.className = 'font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider';
    t.textContent = titulo;
    var v = document.createElement('dd');
    v.className = 'font-body-md text-body-md text-on-surface';
    v.textContent = valor;
    fila.appendChild(t);
    fila.appendChild(v);
    return fila;
  }

  function abrirVistaPrevia() {
    if (!el.modalVista) return;
    var d = recolectar();
    var contenido = el.modalVista.querySelector('[data-vista-contenido]');
    contenido.textContent = '';
    contenido.appendChild(filaVista('Nombre comercial', d.nombre_publico || 'Pendiente de completar'));
    contenido.appendChild(filaVista('Especialidad principal', d.especialidad || 'No especificada'));
    contenido.appendChild(filaVista('Descripción', d.descripcion || 'Pendiente de completar'));
    contenido.appendChild(filaVista('Tarifa de visita', d.tarifa_visita != null ? '$' + formatoCLP(d.tarifa_visita) + ' CLP' : 'No especificada'));
    contenido.appendChild(filaVista('Tarifa de urgencia', d.tarifa_urgencia != null ? '$' + formatoCLP(d.tarifa_urgencia) + ' CLP' : 'No especificada'));
    contenido.appendChild(filaVista('Radio de cobertura', d.radio_cobertura_km ? formatoKm(d.radio_cobertura_km) : 'No especificado'));
    contenido.appendChild(filaVista('Especialidades', d.etiquetas.length ? d.etiquetas.join(', ') : 'Aún no has agregado especialidades'));
    contenido.appendChild(filaVista('Atiende urgencias', d.notificaciones.alertas_urgencia ? 'Sí' : 'No'));
    var aviso = el.modalVista.querySelector('[data-vista-aviso]');
    if (aviso) aviso.hidden = !hayCambios();
    el.modalVista.style.display = 'flex';
    var cerrar = el.modalVista.querySelector('[data-vista-cerrar]');
    if (cerrar) cerrar.focus();
  }

  function cerrarVistaPrevia() {
    if (el.modalVista) el.modalVista.style.display = 'none';
  }

  /* ---------- Carga inicial ---------- */

  function inicializarConPerfil(p, fuenteServidor) {
    estado.cargadoDesdeServidor = fuenteServidor;
    estado.snapshot = p;
    rellenar(p);
    marcarCambios();
  }

  function cargar() {
    var u = usuarioActual();
    estado.modo = modoCuenta(u);

    if (estado.modo === 'none' || estado.modo === 'not-tech') {
      inicializarConPerfil(perfilVacio(), false);
      mostrarAviso(estado.modo === 'none'
        ? 'No hay una sesión iniciada. Inicia sesión con tu cuenta profesional para ver y editar tu perfil.'
        : 'Esta pantalla es solo para cuentas profesionales.');
      mostrarEstado('Sin sesión profesional', 'error');
      return;
    }

    if (estado.modo === 'demo' || estado.modo === 'local') {
      inicializarConPerfil(perfilDesdeSesion(u), false);
      mostrarAviso('Cuenta de demostración local: se muestran solo los datos guardados en este navegador. Esta cuenta no consulta ni modifica perfiles de Railway.');
      mostrarEstado('Modo demostración local', 'neutral');
      return;
    }

    // Cuenta real de Railway.
    var base = perfilDesdeSesion(u);
    if (!tokenSesion()) {
      inicializarConPerfil(base, false);
      mostrarAviso('Tu sesión se inició antes de esta actualización o en otra pestaña. Cierra sesión y vuelve a ingresar para cargar y guardar tu perfil completo.');
      mostrarEstado('Vuelve a iniciar sesión para cargar tu perfil', 'neutral');
      return;
    }

    inicializarConPerfil(base, false);
    mostrarEstado('Cargando perfil desde el servidor…', 'neutral');
    solicitudPerfil('GET').then(function (data) {
      inicializarConPerfil(perfilDesdeServidor(data), true);
      mostrarAviso('');
      if (el.ultimaSync) el.ultimaSync.textContent = 'Hoy ' + horaActual();
    }).catch(function (err) {
      mostrarAviso(mensajeError(err, 'cargar') + ' Se muestran solo los datos básicos de tu sesión.');
      mostrarEstado(mensajeError(err, 'cargar'), 'error');
      if (err && err.tipo === 'no-autorizado') VR.store.set('token', null);
    });
  }

  /* ---------- Eventos ---------- */

  function conectarEventos() {
    document.querySelectorAll('[data-int08-accion]').forEach(function (btn) {
      var accion = btn.getAttribute('data-int08-accion');
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        if (accion === 'guardar') guardar();
        else if (accion === 'descartar') descartar();
        else if (accion === 'vista-previa') abrirVistaPrevia();
      });
    });

    [el.alias, el.especialidad, el.descripcion, el.tarifaVisita, el.tarifaUrgencia,
      el.mostrarWhatsapp, el.mostrarCorreo, el.alertasUrgencia].forEach(function (campo) {
      if (!campo) return;
      campo.addEventListener(campo.type === 'checkbox' || campo.tagName === 'SELECT' ? 'change' : 'input', marcarCambios);
    });

    el.descripcion.addEventListener('input', actualizarContador);

    [el.tarifaVisita, el.tarifaUrgencia].forEach(function (campo) {
      campo.addEventListener('blur', function () {
        var n = leerCLP(campo);
        campo.value = formatoCLP(n);
      });
    });

    el.tagAgregar.addEventListener('click', agregarEtiqueta);
    el.tagInput.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
      e.preventDefault();
      agregarEtiqueta();
    });

    if (el.radios) {
      var botones = Array.prototype.slice.call(el.radios.querySelectorAll('[data-radio-km]'));
      botones.forEach(function (btn, i) {
        btn.addEventListener('click', function () {
          aplicarRadio(Number(btn.getAttribute('data-radio-km')));
          marcarCambios();
        });
        btn.addEventListener('keydown', function (e) {
          var paso = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
          if (!paso) return;
          e.preventDefault();
          var siguiente = botones[(i + paso + botones.length) % botones.length];
          siguiente.focus();
          siguiente.click();
        });
      });
    }

    if (el.modalVista) {
      el.modalVista.querySelectorAll('[data-vista-cerrar]').forEach(function (b) { b.addEventListener('click', cerrarVistaPrevia); });
      el.modalVista.addEventListener('click', function (e) { if (e.target === el.modalVista) cerrarVistaPrevia(); });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && el.modalVista.style.display === 'flex') cerrarVistaPrevia();
      });
    }

    window.addEventListener('beforeunload', function (e) {
      if (!hayCambios()) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  conectarEventos();
  cargar();
})();
