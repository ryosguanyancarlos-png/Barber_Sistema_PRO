const supabaseUrl = 'https://fqedjdwoiqpueiotsyfe.supabase.co';
const supabaseKey = 'sb_publishable_4vVLoGVGzqyAjl9mOqBk0g_pGEwevcz';
const db = window.supabase.createClient(supabaseUrl, supabaseKey);

// "14:30" o "14:30:00" -> "2:30 PM"
function formato12(hhmm) {
    const [h, m] = String(hhmm).split(':').map(Number);
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}


// ===================================================================
//  admin.js · Panel de administración (versión con login real)
//  Cambios respecto a la versión anterior:
//   - Login con correo y contraseña (Supabase Auth). Se acabó el PIN en el código.
//   - Todo texto que viene de la base se "escapa" antes de mostrarlo (evita XSS).
//   - Cada operación revisa si Supabase respondió con error.
//   - Solo se descargan los clientes del día que se está viendo.
// ===================================================================

// ---------- Utilidades ----------
// Convierte texto a "texto seguro" para meterlo dentro de HTML.
// Así, si alguien reserva con el nombre <img onerror=...>, se ve como texto y no se ejecuta.
function escapeHTML(valor) {
    return String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
function soloDigitos(valor) { return String(valor ?? '').replace(/\D/g, ''); }
// Fecha de hoy en Guatemala (YYYY-MM-DD), sin importar la zona horaria del equipo
function fechaHoyGT() { return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guatemala' }); }

function mostrarAlertaAdmin(mensaje) {
    let modal = document.getElementById('modal-alerta-admin');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-alerta-admin';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '3000';
        modal.innerHTML = `
            <div class="modal-box" style="text-align: center; max-width: 320px;">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2" style="margin-bottom: 15px;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                <h3 id="texto-alerta-admin" style="margin-top: 0; margin-bottom: 20px; font-weight: 800; font-size: 1.05rem; color: #111827;"></h3>
                <button onclick="document.getElementById('modal-alerta-admin').style.display='none'" class="btn-submit" style="margin-top: 0;">Entendido</button>
            </div>
        `;
        document.body.appendChild(modal);
    }
    document.getElementById('texto-alerta-admin').innerText = mensaje;
    modal.style.display = 'flex';
}

// ---------- Login (Supabase Auth) ----------
async function verificarLogin() {
    const email = document.getElementById('admin-email').value.trim();
    const password = document.getElementById('admin-pass').value;
    const errorEl = document.getElementById('error-login');
    errorEl.style.display = 'none';

    if (!email || !password) { errorEl.style.display = 'block'; return; }

    // Supabase revisa el correo y la contraseña en SU servidor y nos da una sesión
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) { errorEl.style.display = 'block'; return; }

    document.getElementById('admin-pass').value = '';
    entrarAlPanel();
}

function entrarAlPanel() {
    document.getElementById('pantalla-login').style.display = 'none';
    document.getElementById('contenido-admin').style.display = 'block';
    cargarCitas();
    cargarCatalogoAdmin();
    cargarDiasCerrados();
    cargarConfiguracionAdmin();
}

async function cerrarSesion() {
    await db.auth.signOut();
    location.reload();
}

['admin-email', 'admin-pass'].forEach(id => {
    document.getElementById(id).addEventListener('keypress', function (e) {
        if (e.key === 'Enter') verificarLogin();
    });
});

function cambiarTab(idTab) {
    document.querySelectorAll('.seccion').forEach(sec => sec.classList.remove('activa'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('activa'));
    if (window.event && window.event.currentTarget) {
        window.event.currentTarget.classList.add('activa');
    }
    document.getElementById(idTab).classList.add('activa');
}

// ---------- Confirmaciones ----------
let accionPendiente = null;
let idPendiente = null;

function mostrarConfirmacion(mensaje, accion, id) {
    document.getElementById('texto-confirmacion').innerText = mensaje;
    accionPendiente = accion;
    idPendiente = id;
    document.getElementById('modal-confirmacion').style.display = 'flex';
}

function cerrarConfirmacion() {
    document.getElementById('modal-confirmacion').style.display = 'none';
    accionPendiente = null;
    idPendiente = null;
}

async function ejecutarConfirmacion() {
    document.getElementById('modal-confirmacion').style.display = 'none';
    const accion = accionPendiente;
    const id = idPendiente;
    accionPendiente = null;
    idPendiente = null;

    const acciones = {
        eliminarCita:     { tabla: 'citas',         recargar: cargarCitas },
        eliminarServicio: { tabla: 'servicios',     recargar: cargarCatalogoAdmin },
        abrirDia:         { tabla: 'dias_cerrados', recargar: cargarDiasCerrados }
    };
    const a = acciones[accion];
    if (!a) return;

    try {
        // .select() devuelve las filas borradas. Si viene vacío, la base NO borró nada
        // (por ejemplo, la sesión venció y las reglas RLS lo bloquearon sin avisar).
        const { data, error } = await db.from(a.tabla).delete().eq('id', id).select();
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('No se borró nada');
        a.recargar();
    } catch (error) {
        console.error(error);
        mostrarAlertaAdmin('No se pudo completar la acción. Si el problema sigue, cierra sesión y vuelve a entrar.');
    }
}

// ---------- Agenda ----------
async function cargarCitas() {
    let fechaFiltro = document.getElementById('filtro-fecha').value;
    if (!fechaFiltro) {
        fechaFiltro = fechaHoyGT();
        document.getElementById('filtro-fecha').value = fechaFiltro;
    }
    const contenedor = document.getElementById('lista-citas');
    contenedor.innerHTML = '<p style="text-align:center;">Cargando...</p>';

    try {
        const { data: citas, error: errCitas } = await db.from('citas').select('*').eq('fecha_cita', fechaFiltro).order('hora_cita', { ascending: true });
        if (errCitas) throw errCitas;

        if (!citas || citas.length === 0) {
            contenedor.innerHTML = `<p style="text-align:center; padding: 20px;">No hay citas agendadas para el ${escapeHTML(fechaFiltro)}.</p>`;
            return;
        }

        // Solo pedimos los clientes de las citas de ESTE día (antes se descargaban todos)
        const idsClientes = [...new Set(citas.map(c => c.cliente_id))];
        const { data: clientes, error: errCli } = await db.from('clientes').select('*').in('id', idsClientes);
        if (errCli) throw errCli;
        const { data: servicios, error: errServ } = await db.from('servicios').select('*');
        if (errServ) throw errServ;

        contenedor.innerHTML = '';
        citas.forEach(cita => {
            const cliente = (clientes || []).find(c => c.id === cita.cliente_id) || { nombre: 'Desconocido', telefono: '' };
            const servicio = (servicios || []).find(s => s.id === cita.servicio_id) || { nombre: 'Servicio Borrado', precio: 0 };

            const tel = soloDigitos(cliente.telefono);
            const telWa = tel.length === 8 ? '502' + tel : tel;

            const div = document.createElement('div');
            div.className = 'admin-card';
            div.innerHTML = `
                <div class="admin-card-info">
                    <div class="ticket-badge">#CITA-${escapeHTML(cita.id)}</div>
                    <h3 style="color: #111827;">${escapeHTML(formato12(cita.hora_cita))} - ${escapeHTML(cliente.nombre)}</h3>
                    <p>📞 Tel: <a href="https://wa.me/${escapeHTML(telWa)}" target="_blank" rel="noopener noreferrer" style="color:#1a73e8; text-decoration:none;">${escapeHTML(cliente.telefono)}</a></p>
                    <p>✂️ Servicio: ${escapeHTML(servicio.nombre)} (Q${escapeHTML(servicio.precio)}.00)</p>
                </div>
                <div class="admin-card-acciones">
                    <button class="btn btn-exito">✅ Completado</button>
                    <button class="btn btn-peligro">❌ Cancelar</button>
                </div>
            `;
            div.querySelector('.btn-exito').addEventListener('click', () => mostrarConfirmacion('¿Marcar esta cita como Completada?', 'eliminarCita', cita.id));
            div.querySelector('.btn-peligro').addEventListener('click', () => mostrarConfirmacion('¿Estás seguro de eliminar esta cita de la agenda?', 'eliminarCita', cita.id));
            contenedor.appendChild(div);
        });
    } catch (error) {
        console.error(error);
        contenedor.innerHTML = '<p style="text-align:center; color: var(--danger);">No se pudo cargar la agenda. Revisa tu sesión.</p>';
    }
}

// ---------- Catálogo ----------
let servicioEditando = null;

function abrirDescripcion(serv) {
    servicioEditando = serv;
    document.getElementById('desc-servicio-nombre').innerText = serv.nombre;
    const caja = document.getElementById('desc-texto');
    caja.value = serv.descripcion || '';
    document.getElementById('desc-contador').innerText = caja.value.length + ' / 160';
    document.getElementById('modal-descripcion').style.display = 'flex';
    caja.focus();
}

function cerrarDescripcion() {
    document.getElementById('modal-descripcion').style.display = 'none';
    servicioEditando = null;
}

async function guardarDescripcion() {
    if (!servicioEditando) return;
    const id = servicioEditando.id;
    const texto = document.getElementById('desc-texto').value.trim().slice(0, 160);
    cerrarDescripcion();
    const { data, error } = await db.from('servicios').update({ descripcion: texto || null }).eq('id', id).select();
    if (error || !data || data.length === 0) { mostrarAlertaAdmin('No se pudo guardar la descripción.'); return; }
    mostrarAlertaAdmin('Descripción actualizada.');
    cargarCatalogoAdmin();
}

document.getElementById('desc-texto').addEventListener('input', (e) => {
    document.getElementById('desc-contador').innerText = e.target.value.length + ' / 160';
});

async function cargarCatalogoAdmin() {
    const contenedor = document.getElementById('lista-servicios');
    contenedor.innerHTML = '<p style="text-align:center;">Cargando catálogo...</p>';
    try {
        const { data: servicios, error } = await db.from('servicios').select('*').order('id', { ascending: false });
        if (error) throw error;
        contenedor.innerHTML = '';
        (servicios || []).forEach(serv => {
            const div = document.createElement('div');
            div.className = 'admin-card';
            div.innerHTML = `
                <div class="admin-card-info">
                    <h3 style="color: #111827;">${escapeHTML(serv.nombre)}</h3>
                    <p>Q${escapeHTML(serv.precio)}.00 | ${escapeHTML(serv.duracion_min)} min | Cat: ${escapeHTML(serv.categoria || serv.tipo)}</p>
                    <p style="font-size:0.85rem;color:#6b7280;">${escapeHTML(serv.descripcion || '(sin descripción: se muestra una genérica)')}</p>
                </div>
                <div class="admin-card-acciones">
                    <button class="btn btn-editar" style="background:#e0e7ff;color:#3730a3;margin-right:6px;">Descripción</button>
                    <button class="btn btn-peligro">Bajar</button>
                </div>
            `;
            div.querySelector('.btn-editar').addEventListener('click', () => abrirDescripcion(serv));
            div.querySelector('.btn-peligro').addEventListener('click', () => mostrarConfirmacion('¿Seguro que quieres eliminar este servicio?', 'eliminarServicio', serv.id));
            contenedor.appendChild(div);
        });
    } catch (error) {
        console.error(error);
        contenedor.innerHTML = '<p style="color: var(--danger);">No se pudo cargar el catálogo.</p>';
    }
}

document.getElementById('form-nuevo-servicio').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = document.getElementById('serv-nombre').value.trim();
    const precio = Number(document.getElementById('serv-precio').value);
    const categoria = document.getElementById('serv-categoria').value;
    const duracion = parseInt(document.getElementById('serv-duracion').value, 10);
    const descripcion = document.getElementById('serv-descripcion').value.trim().slice(0, 160);

    if (!nombre || nombre.length > 60 || !(precio >= 0) || !(duracion >= 15)) {
        mostrarAlertaAdmin('Revisa los datos: nombre (máx. 60 letras), precio y duración (mínimo 15 min).');
        return;
    }

    try {
        const { error } = await db.from('servicios').insert([{ nombre, precio, duracion_min: duracion, categoria, descripcion: descripcion || null }]);
        if (error) throw error;
        document.getElementById('form-nuevo-servicio').reset();
        cargarCatalogoAdmin();
        mostrarAlertaAdmin('¡Servicio agregado exitosamente!');
    } catch (error) {
        console.error(error);
        mostrarAlertaAdmin('Error al guardar el servicio.');
    }
});

// ---------- Días bloqueados ----------
async function cargarDiasCerrados() {
    const contenedor = document.getElementById('lista-dias-cerrados');
    contenedor.innerHTML = '<p style="text-align:center;">Cargando...</p>';
    try {
        const { data: dias, error } = await db.from('dias_cerrados').select('*').gte('fecha', fechaHoyGT()).order('fecha', { ascending: true });
        if (error) throw error;
        contenedor.innerHTML = '';
        if (!dias || dias.length === 0) {
            contenedor.innerHTML = '<p style="color: var(--text-sec);">No hay días bloqueados manualmente.</p>';
            return;
        }
        dias.forEach(dia => {
            const div = document.createElement('div');
            div.className = 'admin-card';
            div.innerHTML = `
                <div class="admin-card-info"><h3 style="color: #DC2626;">🚫 Cerrado el: ${escapeHTML(dia.fecha)}</h3></div>
                <div class="admin-card-acciones"><button class="btn btn-primario">Abrir</button></div>
            `;
            div.querySelector('button').addEventListener('click', () => mostrarConfirmacion('¿Abrir de nuevo?', 'abrirDia', dia.id));
            contenedor.appendChild(div);
        });
    } catch (error) {
        console.error(error);
        contenedor.innerHTML = '<p style="color: var(--danger);">No se pudieron cargar los días cerrados.</p>';
    }
}

document.getElementById('form-bloquear-dia').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fecha = document.getElementById('dia-cerrar').value;
    if (fecha < fechaHoyGT()) {
        mostrarAlertaAdmin('No puedes bloquear un día en el pasado.');
        return;
    }
    try {
        const { error } = await db.from('dias_cerrados').insert([{ fecha: fecha }]);
        if (error) throw error;
        document.getElementById('form-bloquear-dia').reset();
        cargarDiasCerrados();
        mostrarAlertaAdmin('Día bloqueado con éxito.');
    } catch (error) {
        console.error(error);
        mostrarAlertaAdmin('Error al bloquear.');
    }
});

// ---------- Configuración ----------
async function cargarConfiguracionAdmin() {
    try {
        const { data: config, error } = await db.from('configuracion').select('*').single();
        if (error) throw error;
        if (config) {
            document.getElementById('cfg-nombre').value = config.nombre_barberia || '';
            document.getElementById('cfg-slogan').value = config.slogan || '';
            document.getElementById('cfg-wsp').value = config.telefono_whatsapp || '';
            document.getElementById('cfg-ig').value = config.instagram || '';
            document.getElementById('cfg-fb').value = config.facebook || '';
        }
    } catch (e) { console.error(e); }
}

document.getElementById('form-config').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = document.getElementById('cfg-nombre').value.trim();
    const slogan = document.getElementById('cfg-slogan').value.trim();
    const wsp = soloDigitos(document.getElementById('cfg-wsp').value);
    const ig = document.getElementById('cfg-ig').value.trim();
    const fb = document.getElementById('cfg-fb').value.trim();

    const urlOk = (u) => u === '' || /^https?:\/\//i.test(u);
    if (wsp.length < 8) {
        mostrarAlertaAdmin('El WhatsApp debe incluir el código de país. Ej. 50245551234');
        return;
    }
    if (!urlOk(ig) || !urlOk(fb)) {
        mostrarAlertaAdmin('Los links de Instagram y Facebook deben empezar con https://');
        return;
    }

    try {
        // .select() para confirmar que la fila de verdad se actualizó
        const { data, error } = await db.from('configuracion').update({
            nombre_barberia: nombre,
            slogan: slogan,
            telefono_whatsapp: wsp,
            instagram: ig,
            facebook: fb
        }).eq('id', 1).select();
        if (error) throw error;
        if (!data || data.length === 0) throw new Error('No se actualizó ninguna fila');

        mostrarAlertaAdmin('¡Configuración actualizada con éxito!');
    } catch (err) {
        console.error(err);
        mostrarAlertaAdmin('Error al actualizar la configuración.');
    }
});

// ---------- Al abrir la página: si ya hay sesión guardada, entra directo ----------
(async () => {
    const { data } = await db.auth.getSession();
    if (data && data.session) entrarAlPanel();
})();