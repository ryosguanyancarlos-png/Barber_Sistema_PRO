const supabaseUrl = 'https://fqedjdwoiqpueiotsyfe.supabase.co';
const supabaseKey = 'sb_publishable_4vVLoGVGzqyAjl9mOqBk0g_pGEwevcz';
const db = window.supabase.createClient(supabaseUrl, supabaseKey);

// "14:30" o "14:30:00" -> "2:30 PM"
function formato12(hhmm) {
    const [h, m] = String(hhmm).split(':').map(Number);
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}


let serviciosGlobal = []; 
let configBarberia = { telefono_whatsapp: "50200000000" };

// ---------- Utilidades de seguridad y de fechas ----------
// Convierte texto a "texto seguro" para meterlo dentro de HTML (evita que alguien inyecte código)
function escapeHTML(valor) {
    return String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
// Solo deja pasar links que empiecen con http:// o https://
function esUrlSegura(url) { return /^https?:\/\//i.test(String(url ?? '').trim()); }
function soloDigitos(valor) { return String(valor ?? '').replace(/\D/g, ''); }

// Fecha y hora "de Guatemala", sin importar la zona horaria del celular
function fechaHoyGT() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' }); }
function minutosAhoraGT() {
    const [h, m] = new Date().toLocaleTimeString('en-GB', { timeZone: 'America/Guatemala', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':');
    return parseInt(h, 10) * 60 + parseInt(m, 10);
}
// "09:15" o "09:15:00"  ->  555 (minutos desde medianoche)
function aMinutos(hhmm) { const [h, m] = String(hhmm).split(':'); return parseInt(h, 10) * 60 + parseInt(m, 10); }
// Redondea la duración hacia arriba a bloques de 15 min
function duracionEnBloques(min) { return Math.max(15, Math.ceil((Number(min) || 15) / 15) * 15); }

// ¿Se puede agendar un servicio de 'duracion' min que empiece a 'hora'?
// (El servidor repite esta revisión; esto solo sirve para no mostrar horas imposibles)
const CORTE_MANANA = 13 * 60;       // 13:00 -> empieza el almuerzo
const CORTE_TARDE = 20 * 60 + 15;   // 20:15 -> fin del último turno
function turnoDisponible(hora, ocupadas, duracion) {
    const ini = aMinutos(hora);
    const fin = ini + duracionEnBloques(duracion);
    const limite = ini < CORTE_MANANA ? CORTE_MANANA : CORTE_TARDE;
    if (fin > limite) return false;                                // se pasa del almuerzo o del cierre
    return !ocupadas.some(o => ini < o.fin && fin > o.ini);         // choca con otra cita
}


const horariosBase = [
    "09:00", "09:15", "09:30", "09:45",
    "10:00", "10:15", "10:30", "10:45",
    "11:00", "11:15", "11:30", "11:45",
    "12:00", "12:15", "12:30", "12:45",
    "14:00", "14:15", "14:30", "14:45",
    "15:00", "15:15", "15:30", "15:45",
    "16:00", "16:15", "16:30", "16:45",
    "17:00", "17:15", "17:30", "17:45",
    "18:00", "18:15", "18:30", "18:45",
    "19:00", "19:15", "19:30", "19:45",
    "20:00"
];

function obtenerDescripcion(nombre, categoria) {
    const nom = nombre.toLowerCase();
    if(nom.includes('barba')) return "Perfilado y alineación profesional con navaja. Incluye aplicación de productos para el cuidado facial.";
    if(nom.includes('cejas')) return "Diseño y limpieza con navaja para un perfilado exacto y simétrico.";
    if(nom.includes('vip') || nom.includes('premium')) return "Servicio completo y detallado. Incluye lavado, preparación de la piel y peinado con producto premium.";
    if(categoria === 'Extra' || categoria === 'extra') return "Complemento ideal para elevar tu cuidado personal y mejorar los resultados de tu corte.";
    return "Corte de cabello clásico o con degradado (fade) a elección, finalizado con terminaciones precisas a navaja.";
}

async function inicializarApp() {
    try {
        const { data: config } = await db.from('configuracion').select('*').single();
        if (config) {
            configBarberia = config;
            document.getElementById('ui-nombre-barberia').innerText = config.nombre_barberia;
            document.getElementById('ui-slogan-barberia').innerText = config.slogan;
            document.getElementById('meta-titulo').innerText = `${config.nombre_barberia} - Reservas`;
            
            const contenedorRedes = document.getElementById('ui-redes');
            contenedorRedes.innerHTML = `
                ${esUrlSegura(config.instagram) ? `<a href="${escapeHTML(config.instagram)}" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg></a>` : ''}
                ${esUrlSegura(config.facebook) ? `<a href="${escapeHTML(config.facebook)}" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24"><path d="M9 8h-3v4h3v12h5v-12h3.642l.358-4h-4v-1.667c0-.955.192-1.333 1.115-1.333h2.885v-5h-3.808c-3.596 0-5.192 1.583-5.192 4.615v3.385z"/></svg></a>` : ''}
                ${soloDigitos(config.telefono_whatsapp) ? `<a href="https://wa.me/${soloDigitos(config.telefono_whatsapp)}" target="_blank" rel="noopener noreferrer"><svg viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.245 3.481 5.228 3.481 8.411-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.306 1.657zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.347-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.876 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/></svg></a>` : ''}
            `;
        }

        const { data: servicios, error } = await db.from('servicios').select('*');
        if (error) throw error;
        serviciosGlobal = servicios; 

        const gridServicios = document.getElementById('grid-servicios');
        const gridExtras = document.getElementById('grid-extras');
        gridServicios.innerHTML = ''; gridExtras.innerHTML = '';

        servicios.forEach(servicio => {
            const div = document.createElement('div');
            div.className = 'servicio-card';
            div.setAttribute('data-id', servicio.id);
            
            // Si el barbero escribió una descripción, se usa esa; si no, una genérica
            const propia = (servicio.descripcion || '').trim();
            const descripcion = propia ? escapeHTML(propia) : obtenerDescripcion(servicio.nombre, servicio.categoria || servicio.tipo);
            
            div.innerHTML = `
                <div class="check-icono">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                </div>
                <div class="card-header">
                    <h3 class="card-title">${escapeHTML(servicio.nombre)}</h3>
                    <p class="card-price">Q ${escapeHTML(servicio.precio)}.00</p>
                </div>
                <p class="card-desc">${descripcion}</p>
                <div class="badge">${servicio.categoria === 'Extra' || servicio.tipo === 'Extra' ? 'Complemento' : 'Corte Clásico'}</div>
                <div class="card-duration">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                    Duración ${escapeHTML(servicio.duracion_min)} min
                </div>
                <button type="button" class="btn-reservar">Agendar este servicio</button>
            `;
            
            div.querySelector('.btn-reservar').addEventListener('click', () => abrirModal(servicio.id, servicio.nombre));
            if (servicio.categoria === 'Extra' || servicio.tipo === 'Extra') gridExtras.appendChild(div);
            else gridServicios.appendChild(div);
        });
    } catch (error) { console.error("Error inicializando app:", error); }
}

function mostrarAlerta(mensaje) {
    document.getElementById('texto-alerta').innerText = mensaje;
    document.getElementById('modal-alerta').classList.add('modal-activo');
}
function cerrarAlerta() { document.getElementById('modal-alerta').classList.remove('modal-activo'); }

function validarFormulario() {
    const nombre = document.getElementById('nombre').value.trim();
    const telefono = document.getElementById('telefono').value.trim();
    const fecha = document.getElementById('fecha').value;
    const hora = document.getElementById('hora-seleccionada').value;
    const btnConfirmar = document.getElementById('btn-confirmar');

    if (nombre !== "" && telefono !== "" && fecha !== "" && hora !== "") {
        btnConfirmar.disabled = false;
    } else {
        btnConfirmar.disabled = true;
    }
}

document.getElementById('form-reserva').addEventListener('input', validarFormulario);

function abrirModal(servicioId, servicioNombre) {
    document.querySelectorAll('.servicio-card').forEach(card => card.classList.remove('card-seleccionada'));
    const tarjetaElegida = document.querySelector(`.servicio-card[data-id="${servicioId}"]`);
    if(tarjetaElegida) tarjetaElegida.classList.add('card-seleccionada');

    document.getElementById('modal-reserva').classList.add('modal-activo');
    document.getElementById('titulo-modal').innerText = servicioNombre;
    document.getElementById('servicio-id-modal').value = servicioId;
    document.getElementById('contenedor-horarios').style.display = 'none'; 
    
    const hoy = fechaHoyGT();
    document.getElementById('fecha').setAttribute('min', hoy);
    validarFormulario(); 
}

function cerrarModal() {
    document.getElementById('modal-reserva').classList.remove('modal-activo');
    document.getElementById('form-reserva').reset();
    document.getElementById('hora-seleccionada').value = "";
    document.querySelectorAll('.servicio-card').forEach(card => card.classList.remove('card-seleccionada'));
    validarFormulario();
}

function abrirModalExito(idCita, nombreCliente) {
    document.getElementById('modal-exito').classList.add('modal-activo');
    document.getElementById('ticket-texto').innerText = `#CITA-${idCita}`;
    
    const mensaje = `Hola, acabo de agendar un turno.\nMi nombre es *${nombreCliente}*\nMi número de ticket es el *#CITA-${idCita}*.\n\n*Recuerda confirmar mi cita en tu panel de horario.*`;
    document.getElementById('link-whatsapp').href = `https://wa.me/${soloDigitos(configBarberia.telefono_whatsapp)}?text=${encodeURIComponent(mensaje)}`;
}

function cerrarModalExito() { 
    document.getElementById('modal-exito').classList.remove('modal-activo'); 
    document.querySelectorAll('.servicio-card').forEach(card => card.classList.remove('card-seleccionada'));
}

document.getElementById('fecha').addEventListener('change', async function(e) {
    const fechaElegida = e.target.value;
    const contenedorHorarios = document.getElementById('contenedor-horarios');
    const alertaDomingo = document.getElementById('alerta-domingo');
    const seccionCuadricula = document.getElementById('seccion-cuadricula');
    const gridHorarios = document.getElementById('grid-horarios');
    
    document.getElementById('hora-seleccionada').value = ""; 
    validarFormulario(); 
    
    if(!fechaElegida) {
        contenedorHorarios.style.display = 'none';
        return;
    }
    
    contenedorHorarios.style.display = 'block';

    const fechaObj = new Date(fechaElegida + 'T00:00:00');
    if (fechaObj.getDay() === 0) { 
        alertaDomingo.querySelector('.alerta-texto').innerText = "La barbería no atiende los domingos. Por favor selecciona otro día.";
        alertaDomingo.classList.add('alerta-cerrado-activa');
        seccionCuadricula.style.display = 'none';
        return; 
    } 

    try {
        const { data: diaBloqueado } = await db.from('dias_cerrados').select('id').eq('fecha', fechaElegida);
        if (diaBloqueado && diaBloqueado.length > 0) {
            alertaDomingo.querySelector('.alerta-texto').innerText = "El barbero no atenderá en esta fecha específica. Por favor elige otro día.";
            alertaDomingo.classList.add('alerta-cerrado-activa');
            seccionCuadricula.style.display = 'none';
            return;
        }
    } catch (e) { console.error(e); }
    
    alertaDomingo.classList.remove('alerta-cerrado-activa');
    seccionCuadricula.style.display = 'block';
    gridHorarios.innerHTML = '<p style="grid-column: span 3; text-align:center; color: #6b7280; font-size: 0.9rem;">Cargando...</p>';

    try {
        // Le pedimos a Supabase SOLO las horas ocupadas (sin nombres ni teléfonos)
        const { data: ocupadasBD, error } = await db.rpc('horarios_ocupados', { p_fecha: fechaElegida });
        if (error) throw error;

        // Cada cita ocupada = un rango [inicio, fin) en minutos
        const ocupadas = (ocupadasBD || []).map(o => {
            const ini = aMinutos(o.hora);
            return { ini, fin: ini + duracionEnBloques(o.duracion) };
        });

        // Duración del servicio que el cliente está agendando
        const servicioId = parseInt(document.getElementById('servicio-id-modal').value, 10);
        const servicioElegido = serviciosGlobal.find(s => s.id === servicioId);
        const duracionElegida = servicioElegido ? servicioElegido.duracion_min : 15;

        const esHoy = fechaElegida === fechaHoyGT();
        const ahora = minutosAhoraGT();

        gridHorarios.innerHTML = '';
        horariosBase.forEach(hora => {
            const ini = aMinutos(hora);
            const fin = ini + duracionEnBloques(duracionElegida);
            const limite = ini < CORTE_MANANA ? CORTE_MANANA : CORTE_TARDE;
            // Si el servicio se cruzaría con el almuerzo o el cierre, esa hora ni se muestra
            if (fin > limite) return;

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn-hora';
            btn.innerText = formato12(hora);

            const yaPaso = esHoy && ini <= ahora;
            const estaOcupada = ocupadas.some(o => ini >= o.ini && ini < o.fin);   // cae dentro de otra cita
            const chocaDespues = ocupadas.some(o => ini < o.fin && fin > o.ini);   // libre, pero no alcanza

            if (yaPaso || estaOcupada) {
                btn.classList.add('ocupada');
                btn.disabled = true;
                btn.title = 'Ocupado';
            } else if (chocaDespues) {
                btn.classList.add('noalcanza');
                btn.disabled = true;
                btn.title = 'No alcanza: tu servicio dura ' + duracionEnBloques(duracionElegida) + ' min y hay otra cita después';
            } else {
                btn.classList.add('libre');
                btn.onclick = function() {
                    document.querySelectorAll('.btn-hora').forEach(b => b.classList.remove('seleccionada'));
                    btn.classList.add('seleccionada');
                    document.getElementById('hora-seleccionada').value = hora;
                    validarFormulario();
                };
            }
            gridHorarios.appendChild(btn);
        });

    } catch (error) {
        console.error(error);
        gridHorarios.innerHTML = '<p style="grid-column: span 3; text-align:center; color: #DC2626; font-size: 0.9rem;">No se pudieron cargar los horarios. Intenta de nuevo.</p>';
    }
});

document.getElementById('form-reserva').addEventListener('submit', async function(e) {
    e.preventDefault(); 
    
    const servicioId = document.getElementById('servicio-id-modal').value;
    const nombre = document.getElementById('nombre').value;
    const telefono = document.getElementById('telefono').value;
    const fecha = document.getElementById('fecha').value;
    const hora = document.getElementById('hora-seleccionada').value; 
    const btnConfirmar = document.getElementById('btn-confirmar');

    try {
        btnConfirmar.innerText = 'Guardando cita...';
        btnConfirmar.disabled = true;

        // Una sola llamada: el servidor valida todo y guarda cliente + cita juntos
        const { data: citaId, error } = await db.rpc('crear_cita', {
            p_nombre: nombre.trim(),
            p_telefono: telefono.trim(),
            p_servicio_id: parseInt(servicioId, 10),
            p_fecha: fecha,
            p_hora: hora
        });
        if (error) throw error;

        cerrarModal();
        abrirModalExito(citaId, nombre.trim());

    } catch (error) {
        console.error("Error:", error);
        // P0001 = mensajes que escribimos nosotros en la base (ej. "Ese horario ya fue tomado")
        const esMensajeNuestro = error && error.code === 'P0001';
        mostrarAlerta(esMensajeNuestro ? error.message : "Hubo un problema al guardar la cita.");
        btnConfirmar.innerText = 'Confirmar Cita';
        if (esMensajeNuestro) {
            // Probablemente alguien tomó el horario: recargamos la cuadrícula (esto también limpia la hora elegida)
            document.getElementById('fecha').dispatchEvent(new Event('change'));
        } else {
            btnConfirmar.disabled = false;
        }
    }
});

inicializarApp();