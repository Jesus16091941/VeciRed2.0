/*
 * INT-13: perfil público de un profesional real (id numérico de MariaDB).
 * Los perfiles de demostración (seed-*) los sigue pintando el script en línea de INT-13.
 * Nunca se inventan datos: un campo vacío conserva su lugar con un mensaje orientativo.
 */
(function () {
  'use strict';

  var API_BASE = 'https://vecired20-production.up.railway.app';
  var params = new URLSearchParams(window.location.search);
  var profileId = params.get('profile') || '';
  if (!/^\d+$/.test(profileId)) return;

  var HINTS = {
    foto: 'Aquí se mostrará la foto de perfil del profesional.',
    alias: 'Aquí se mostrará el nombre público o alias del profesional.',
    especialidad: 'Aquí se mostrará su especialidad principal.',
    descripcion: 'Este espacio permite conocer mejor al profesional.',
    especialidades: 'Aquí se mostrará la especialidad del profesional.',
    etiquetas: 'Aquí se mostrarán las etiquetas de sus servicios.',
    certificaciones: 'Aquí se mostrarán las certificaciones del profesional.',
    tarifas: 'Aquí se mostrarán los valores de sus servicios.',
    tarifaVisita: 'Aquí se mostrará el valor de la visita.',
    tarifaUrgencia: 'Aquí se mostrará el valor de atención de urgencia.',
    radio: 'Aquí se mostrará el radio de cobertura.',
    comunas: 'Aquí se mostrarán las comunas donde trabaja.',
    galeria: 'Aquí se mostrarán fotos de trabajos realizados por el profesional.',
    resenas: 'Aquí se mostrarán las opiniones de los vecinos que contraten sus servicios.',
    historial: 'Aquí se mostrará su historial de trabajos.',
    respuesta: 'Aquí se mostrará su tiempo de respuesta.',
    recomendaciones: 'Aquí se mostrarán las recomendaciones de vecinos.'
  };

  function $(selector, root) { return (root || document).querySelector(selector); }
  function $all(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }
  function byText(selector, matcher, root) {
    return $all(selector, root).find(function (el) {
      var t = el.textContent.trim();
      return typeof matcher === 'string' ? t.indexOf(matcher) !== -1 : matcher.test(t);
    });
  }
  function sectionByHeading(text) {
    var h = byText('h2', text);
    return h ? h.closest('section') : null;
  }
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function hint(text, tag) {
    var node = el(tag || 'p', 'flex items-start gap-1.5 font-body-sm text-body-sm text-on-surface-variant italic');
    node.setAttribute('data-vr-hint', '');
    var icon = el('span', 'material-symbols-outlined text-[16px] text-outline not-italic shrink-0 mt-0.5', 'info');
    icon.setAttribute('aria-hidden', 'true');
    node.appendChild(icon);
    node.appendChild(el('span', '', text));
    return node;
  }
  function setContent(target, child) {
    if (!target) return;
    target.textContent = '';
    target.appendChild(child);
  }
  function clp(value) {
    var n = Number(value);
    if (value == null || value === '' || !isFinite(n) || n <= 0) return '';
    return '$' + Math.round(n).toLocaleString('es-CL') + ' CLP';
  }
  function initials(name) {
    return String(name || '').split(/\s+/).filter(Boolean).slice(0, 2)
      .map(function (p) { return p.charAt(0); }).join('').toUpperCase() || 'VR';
  }
  function avatarSvg(name) {
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">' +
      '<rect width="320" height="320" rx="28" fill="#0f2942"/>' +
      '<text x="160" y="190" text-anchor="middle" font-family="Arial,sans-serif" font-size="110" font-weight="700" fill="#6bd8cb">' +
      initials(name).replace(/[<>&"]/g, '') + '</text></svg>';
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
  }

  var leftAside = $all('aside')[0];
  var rightAside = $all('aside')[1];

  function render(p, error) {
    var d = p || {};
    var name = d.nombre_corto || '';
    var firstName = name.split(/\s+/)[0] || 'el profesional';

    document.title = (name || 'Perfil profesional') + ' | Perfil público VeciRed';

    var crumbLink = byText('nav a', /^Técnicos( en |$)/);
    var crumbNav = crumbLink && crumbLink.closest('nav');
    if (crumbLink) crumbLink.textContent = d.barrio ? 'Técnicos en ' + d.barrio : 'Técnicos';
    var crumb = crumbNav && $all('span.font-semibold.text-primary', crumbNav).pop();
    if (crumb) crumb.textContent = name ? name + (d.especialidad ? ' - ' + d.especialidad : '') : 'Perfil profesional';
    var audited = byText('div.hidden.sm\\:flex', 'Perfil auditado');
    if (audited) audited.classList.toggle('sm:flex', !!d.verificado);

    if (leftAside) {
      var img = $('img', leftAside);
      if (img) {
        var wrap = img.parentElement;
        var status = $('.absolute.-bottom-2', wrap);
        if (status) status.remove();
        var showInitials = function () {
          img.onerror = null;
          img.src = avatarSvg(name);
          img.alt = name ? 'Iniciales de ' + name + '; aún no hay foto de perfil' : 'Foto de perfil no disponible';
          if (!$('[data-vr-photo-hint]', wrap.parentElement)) {
            var photoHint = hint(HINTS.foto);
            photoHint.setAttribute('data-vr-photo-hint', '');
            photoHint.classList.add('justify-center', 'text-center', 'mb-space-sm');
            wrap.insertAdjacentElement('afterend', photoHint);
          }
        };
        var photoPath = typeof d.foto_url === 'string' && /^\/profesionales\/\d+\/foto(\?v=[0-9a-f]+)?$/.test(d.foto_url) ? d.foto_url : '';
        if (photoPath) {
          var existingHint = $('[data-vr-photo-hint]', wrap.parentElement);
          if (existingHint) existingHint.remove();
          img.onerror = showInitials;
          img.alt = 'Foto de perfil de ' + (name || 'el profesional');
          img.src = API_BASE + photoPath;
        } else {
          showInitials();
        }
      }

      var badge = byText('div', /^Disponible ahora en tu zona$/, leftAside);
      if (badge) badge.lastChild.textContent = ' Profesional registrado en VeciRed';

      var heading = $('h1', leftAside);
      if (heading) heading.textContent = name || 'Perfil profesional';
      var nameParas = heading ? $all('p', heading.parentElement) : [];
      if (nameParas[0]) {
        nameParas[0].textContent = '';
        if (d.nombre_publico) {
          nameParas[0].appendChild(document.createTextNode('Conocido/a en el barrio como '));
          nameParas[0].appendChild(el('span', 'text-primary font-semibold italic', '"' + d.nombre_publico + '"'));
        } else {
          setContent(nameParas[0], hint(HINTS.alias, 'span'));
          nameParas[0].firstChild.classList.add('justify-center');
        }
      }
      if (nameParas[1]) {
        nameParas[1].textContent = '';
        if (d.especialidad) {
          nameParas[1].appendChild(el('span', 'material-symbols-outlined text-[18px]', 'engineering'));
          nameParas[1].appendChild(document.createTextNode(' ' + d.especialidad));
        } else {
          var sp = hint(HINTS.especialidad, 'span');
          sp.classList.add('justify-center', 'font-normal');
          nameParas[1].appendChild(sp);
        }
      }

      var stampTitle = byText('span', /^(Sello de Vecino Verificado|Sello Profesional Verificado|Verificación en proceso)$/, leftAside);
      if (stampTitle) {
        stampTitle.textContent = d.verificado ? 'Sello Profesional Verificado' : 'Verificación en proceso';
        var stampBox = stampTitle.closest('.flex.items-start');
        var stampIcon = stampBox && $('.material-symbols-outlined', stampBox);
        if (stampIcon) stampIcon.textContent = d.verificado ? 'verified' : 'hourglass_top';
        var stampText = stampTitle.closest('.flex-1') && $('p', stampTitle.closest('.flex-1'));
        if (stampText) stampText.textContent = d.verificado
          ? 'Identidad y antecedentes revisados por VeciRed.'
          : 'VeciRed aún está revisando la identidad y los antecedentes de este profesional.';
      }

      var rating = $all('.text-headline-lg', leftAside).find(function (n) { return n.tagName !== 'H1'; });
      if (rating) {
        rating.textContent = '—';
        var starRow = rating.parentElement && $('.text-amber-500', rating.parentElement);
        if (starRow) $all('.material-symbols-outlined', starRow).forEach(function (s) {
          s.style.fontVariationSettings = "'FILL' 0";
        });
      }
      var reviewCount = byText('span', /reseñas locales/, leftAside);
      if (reviewCount) reviewCount.textContent = '0 reseñas locales';
      var satisfaction = byText('span', /Satisfacción|Sin evaluaciones/, leftAside);
      if (satisfaction) satisfaction.textContent = 'Sin evaluaciones';

      var metrics = $all('.grid.grid-cols-2 > div', leftAside);
      [[metrics[0], HINTS.historial], [metrics[1], HINTS.respuesta]].forEach(function (pair) {
        if (!pair[0]) return;
        var spans = $all('span', pair[0]);
        if (spans[1]) { spans[1].textContent = '—'; spans[1].classList.remove('text-secondary'); spans[1].classList.add('text-primary'); }
        if (spans[2]) spans[2].textContent = pair[1];
      });

      var guarantees = byText('h3', 'Garantías Activas VeciRed', leftAside);
      var gCard = guarantees && guarantees.parentElement;
      if (gCard) {
        var emergency = byText('li', 'Emergencias 24/7', gCard);
        if (emergency) emergency.remove();
        var credRow = $('.mt-space-md.pt-space-sm.border-t', gCard);
        if (credRow) {
          credRow.className = 'mt-space-md pt-space-sm border-t border-outline-variant/30 flex flex-col gap-space-xs';
          credRow.setAttribute('data-vr-certs', '');
          credRow.textContent = '';
          credRow.appendChild(el('span', 'font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wider', 'Certificaciones'));
          var certs = Array.isArray(d.certificaciones) ? d.certificaciones : [];
          if (certs.length) {
            var ul = el('ul', 'flex flex-col gap-space-xs');
            certs.forEach(function (c) {
              var li = el('li', 'flex items-start gap-space-xs text-body-sm');
              li.appendChild(el('span', 'material-symbols-outlined text-secondary text-[18px] shrink-0 mt-0.5', 'workspace_premium'));
              var txt = el('span', 'text-on-surface');
              txt.appendChild(el('strong', 'text-primary', c.nombre));
              if (c.institucion) txt.appendChild(document.createTextNode(' · ' + c.institucion));
              li.appendChild(txt);
              ul.appendChild(li);
            });
            credRow.appendChild(ul);
          } else {
            credRow.appendChild(hint(HINTS.certificaciones));
          }
        }
      }
    }

    var bio = sectionByHeading('Sobre mí');
    if (bio) {
      var years = byText('span', /Años en el sector|años de experiencia|Perfil profesional verificado/i, bio);
      var anos = Number(d.anos_experiencia);
      if (years) years.textContent = anos > 0 ? anos + '+ años de experiencia' : '';
      var bioParas = $all(':scope > p', bio);
      if (bioParas[0]) {
        if (d.descripcion) {
          bioParas[0].className = 'text-body-md text-on-surface leading-relaxed whitespace-pre-line';
          bioParas[0].textContent = d.descripcion;
        } else {
          bioParas[0].className = '';
          setContent(bioParas[0], hint(HINTS.descripcion, 'span'));
        }
      }
      bioParas.slice(1).forEach(function (n) { n.remove(); });
    }

    var spec = sectionByHeading('Especialidades y Servicios');
    if (spec) {
      var grid = $('.grid', spec);
      if (grid) {
        grid.textContent = '';
        if (d.especialidad) {
          var card = el('div', 'p-space-sm rounded-lg bg-surface-container-low border border-outline-variant/30 flex items-start gap-space-xs');
          card.appendChild(el('span', 'material-symbols-outlined text-secondary text-[20px] mt-0.5', 'handyman'));
          card.appendChild(el('h4', 'font-label-lg text-label-lg font-bold text-primary', d.especialidad));
          grid.appendChild(card);
        } else {
          grid.appendChild(hint(HINTS.especialidades));
        }
      }
      var pills = $('.mt-space-md.flex.flex-wrap', spec);
      if (pills) {
        pills.textContent = '';
        var tags = Array.isArray(d.etiquetas) ? d.etiquetas : [];
        if (tags.length) tags.forEach(function (t) {
          pills.appendChild(el('span', 'px-2.5 py-1 rounded-full text-label-sm font-semibold bg-surface-container-high text-on-surface', t));
        });
        else pills.appendChild(hint(HINTS.etiquetas));
      }
    }

    var gallery = sectionByHeading('Galería de Trabajos');
    if (gallery) {
      var gGrid = $('.grid', gallery);
      if (gGrid) setContent(gGrid, hint(HINTS.galeria));
      var gCount = $('.flex.items-center.justify-between > span', gallery);
      if (gCount) gCount.textContent = '';
    }

    var reviews = sectionByHeading('Opiniones de Vecinos');
    if (reviews) {
      var list = $('.space-y-space-lg.mt-space-md', reviews);
      if (list) {
        $all(':scope > article:not([data-vr-user-review])', list).forEach(function (a) {
          if (!a.classList.contains('bg-secondary-container/20')) a.remove();
        });
        if (!$('article', list) && !$('[data-vr-hint]', list)) list.appendChild(hint(HINTS.resenas));
      }
      var allTab = $('button', reviews);
      if (allTab && /\(\d+\)/.test(allTab.textContent) && !$('article', reviews)) allTab.textContent = 'Todas (0)';
      var more = byText('button', /opiniones restantes/, reviews);
      if (more && more.parentElement) more.parentElement.remove();
    }

    if (rightAside) {
      var radar = $('.bg-secondary-container\\/20', rightAside);
      if (radar) {
        radar.textContent = '';
        var title = el('div', 'flex items-center gap-space-xs text-secondary font-label-md font-bold');
        title.appendChild(el('span', 'material-symbols-outlined text-[20px]', 'near_me'));
        var radio = Number(d.radio_cobertura_km);
        title.appendChild(el('span', '', radio > 0 ? 'Cobertura de ' + radio + ' km' : 'Cobertura'));
        radar.appendChild(title);
        if (!(radio > 0)) radar.appendChild(hint(HINTS.radio));
        var comunas = Array.isArray(d.comunas) ? d.comunas : [];
        if (comunas.length) {
          var cl = el('p', 'font-body-sm text-body-sm text-on-surface mt-1');
          cl.appendChild(el('strong', '', 'Comunas: '));
          cl.appendChild(document.createTextNode(comunas.join(', ')));
          radar.appendChild(cl);
        } else {
          var ch = hint(HINTS.comunas);
          ch.classList.add('mt-1');
          radar.appendChild(ch);
        }
        if (d.barrio) {
          var base = el('div', 'mt-1 flex items-center gap-1 text-[12px] text-on-surface-variant font-medium');
          base.appendChild(el('span', 'material-symbols-outlined text-[15px] text-secondary', 'location_on'));
          base.appendChild(el('span', 'truncate', 'Barrio base: ' + d.barrio));
          radar.appendChild(base);
        }
      }
      var mapBadge = byText('span', /^(En rango directo|Zona de trabajo)$/, rightAside);
      if (mapBadge) mapBadge.textContent = 'Zona de trabajo';

      var tariffLabel = byText('span', /^Tarifa Referencial$|^Tarifas$/, rightAside);
      var tariff = tariffLabel && tariffLabel.parentElement;
      if (tariff) {
        tariffLabel.textContent = 'Tarifas';
        $all(':scope > :not(:first-child)', tariff).forEach(function (n) { n.remove(); });
        var visita = clp(d.tarifa_visita);
        var urgencia = clp(d.tarifa_urgencia);
        if (!visita && !urgencia) {
          var th = hint(HINTS.tarifas);
          th.classList.add('mt-1');
          tariff.appendChild(th);
        } else {
          [[visita, '/ visita', HINTS.tarifaVisita, 'font-headline-lg text-headline-lg'],
           [urgencia, '/ urgencia', HINTS.tarifaUrgencia, 'font-label-lg text-label-lg']].forEach(function (row) {
            if (row[0]) {
              var r = el('div', 'flex items-baseline gap-1 mt-0.5');
              r.appendChild(el('span', row[3] + ' font-bold text-primary', row[0]));
              r.appendChild(el('span', 'font-body-sm text-body-sm text-on-surface-variant', row[1]));
              tariff.appendChild(r);
            } else {
              var h = hint(row[2]);
              h.classList.add('mt-1');
              tariff.appendChild(h);
            }
          });
        }
      }

      var chat = byText('button span', /^Chatear con /, rightAside);
      if (chat) chat.textContent = 'Chatear con ' + firstName;
      var escrow = byText('p', /solo cobra cuando/, rightAside);
      if (escrow) escrow.textContent = 'Tu dinero permanece en custodia protegida. ' + (name ? firstName : 'El profesional') + ' solo cobra cuando apruebas el trabajo como 100% terminado.';

      var quote = byText('[data-go]', /Solicitar Presupuesto/i, rightAside);
      if (quote) {
        quote.setAttribute('data-go', 'INT-14.html?profile=' + encodeURIComponent(profileId) + '&destino=specific');
        quote.setAttribute('data-profile-id', profileId);
        quote.setAttribute('aria-label', 'Solicitar presupuesto' + (name ? ' dirigido a ' + name : ''));
      }

      var oldEmail = $('[data-vr-contact-email]', rightAside);
      if (oldEmail) oldEmail.remove();
      var email = typeof d.correo === 'string' ? d.correo.trim() : '';
      if (quote && /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email)) {
        var emailRow = el('p', 'mt-space-sm flex items-center justify-center gap-1.5 font-body-sm text-body-sm text-on-surface-variant');
        emailRow.setAttribute('data-vr-contact-email', '');
        emailRow.appendChild(el('span', 'material-symbols-outlined text-[16px] text-secondary', 'mail'));
        emailRow.firstChild.setAttribute('aria-hidden', 'true');
        var mail = el('a', 'text-primary font-semibold underline underline-offset-2 break-all', email);
        mail.href = 'mailto:' + encodeURIComponent(email).replace(/%40/g, '@');
        mail.setAttribute('aria-label', 'Enviar correo a ' + (name || 'el profesional'));
        emailRow.appendChild(mail);
        quote.insertAdjacentElement('afterend', emailRow);
      }
    }

    var endorse = byText('div > span', /Recomendado por|recomendaciones de vecinos/);
    if (endorse) endorse.textContent = HINTS.recomendaciones;

    $all('[data-vr-public-profile-link]').forEach(function (link) {
      link.href = 'INT-13.html?profile=' + encodeURIComponent(profileId);
    });

    var notice = $('[data-vr-profile-error]');
    if (error && !notice) {
      notice = el('div', 'max-w-container-max mx-auto px-space-lg pt-space-lg');
      notice.setAttribute('data-vr-profile-error', '');
      notice.setAttribute('role', 'alert');
      notice.appendChild(el('p', 'p-space-md rounded-lg bg-error-container text-on-error-container font-label-md', error));
      var body = $('main .max-w-container-max.py-space-xl');
      if (body) body.parentElement.insertBefore(notice, body);
    } else if (!error && notice) {
      notice.remove();
    }
  }

  var grid = $('main .grid.lg\\:grid-cols-12');
  render(null);
  if (grid) grid.setAttribute('aria-busy', 'true');

  fetch(API_BASE + '/profesionales/' + encodeURIComponent(profileId) + '/perfil-publico', {
    headers: { Accept: 'application/json' }
  }).then(function (res) {
    if (res.status === 404) throw new Error('not-found');
    if (!res.ok) throw new Error('server');
    return res.json();
  }).then(function (data) {
    if (String(data && data.id) !== profileId) throw new Error('server');
    render(data);
  }).catch(function (err) {
    render(null, err && err.message === 'not-found'
      ? 'Este perfil profesional no existe o no está disponible.'
      : 'No se pudo cargar el perfil en este momento. Intenta nuevamente más tarde.');
  }).then(function () {
    if (grid) grid.removeAttribute('aria-busy');
  });
})();
