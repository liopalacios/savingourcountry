const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
const axios = require('axios');
const crypto = require('crypto');
let sock = null;
let isConnected = false;
let qrCodeData = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// Logger configurado para menos ruido
const logger = pino({ level: 'silent' });

// Crear carpeta para almacenar sesión
const authFolder = path.join(__dirname, 'auth_info');
const AUTH_FOLDER = path.resolve('./auth_info')

if (!fs.existsSync(authFolder)) {
    fs.mkdirSync(authFolder);
}

async function connectToWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(authFolder);
        
        // Obtener la última versión de Baileys
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`Usando WA v${version.join('.')}, es la última: ${isLatest}`);
        
        sock = makeWASocket({
            version,
            logger,
            auth: state,
            browser: ['WhatsApp Bot', 'Chrome', '1.0.0'],
            // Configuración para mejor estabilidad
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 0,
            keepAliveIntervalMs: 10000,
            emitOwnEvents: true,
            fireInitQueries: true,
            generateHighQualityLinkPreview: false,
            syncFullHistory: false,
            markOnlineOnConnect: true,
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            
            if (qr) {
                qrCodeData = qr;
                console.log('\n========================================');
                console.log('📱 CÓDIGO QR DISPONIBLE');
                console.log('========================================');
                console.log('Escanea este código QR con WhatsApp:');
                console.log('WhatsApp → Menú (⋮) → Dispositivos vinculados → Vincular un dispositivo\n');
                console.log('QR Code:', qr);
                qrcode.generate(qr, { small: true });
                console.log('========================================\n');
                
                // También puedes guardarlo en un archivo para verlo
                fs.writeFileSync('qr.txt', qr);
                console.log('✅ Código QR guardado en qr.txt\n');
            }
            
            if (connection === 'close') {
                isConnected = false;
                qrCodeData = null;
                
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
                
                console.log('❌ Conexión cerrada debido a:', lastDisconnect?.error);
                
                if (statusCode === DisconnectReason.loggedOut) {
                    console.log('🚪 Sesión cerrada. Elimina la carpeta auth_info y vuelve a escanear el QR');
                    reconnectAttempts = 0;
                } else if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttempts++;
                    console.log(`🔄 Intentando reconectar (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
                    setTimeout(() => connectToWhatsApp(), 3000);
                } else if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
                    console.log('❌ Máximo de intentos de reconexión alcanzado');
                    console.log('💡 Solución: Elimina la carpeta auth_info y reinicia el servidor');
                }
            } else if (connection === 'open') {
                console.log('\n✅ ¡CONECTADO EXITOSAMENTE A WHATSAPP!\n');
                isConnected = true;
                qrCodeData = null;
                reconnectAttempts = 0;
            } else if (connection === 'connecting') {
                console.log('🔄 Conectando a WhatsApp...');
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // Manejar mensajes entrantes (opcional)
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;

            for (const msg of messages) {
                console.log("1111");
                 if (msg.key.fromMe) {
                    console.log('🚫 Mensaje propio ignorado');
                    //continue;
                }
console.log("2222");
                // 🔥 MANEJO DE TEXTO (código existente)
                const text =
                    msg.message?.conversation ||
                    msg.message?.extendedTextMessage?.text ||
                    msg.message?.imageMessage?.url ||
                    msg.message?.videoMessage?.caption ||
                    null;
                console.log('📩 Mensaje recibido text:', text);
                if (!text) continue;

                
console.log("3333");

                // Ignorar mensajes propios (evitar bucles)
                //if (msg.key.fromMe) continue;
                
                console.log('📥 Nuevo mensaje recibido');
                if (!msg.message) {
                    console.log("⚠️ Mensaje sin contenido (ignorado)");
                    return;
                }
                console.log("4444");
                // Obtener información básica
                const remoteJid = msg.key.remoteJid;
                const isGroup = remoteJid.endsWith('@g.us');
                const sender = isGroup ? msg.key.participant : remoteJid;

                console.log(`📨 ${sender}: ${text}`);
console.log("555555");
                if (isGroup) {
                    console.log(`📋 Mensaje de grupo ignorado: ${remoteJid}`);
                    return; // Salir sin procesar
                }
console.log("6666");
                const checkSender = await axios.post(
                            'http://localhost:8000/whatsapp/check-sender',
                            { sender },
                            { timeout: 10000 }
                        );
                try {
                    console.log(msg.message);                            
                    if (checkSender.data?.exists && !msg.message?.imageMessage) {

                        const textoUpper = text.trim().toUpperCase();

                        if (textoUpper === "SI" || textoUpper === "SÍ"|| textoUpper === "Y" ||
                            textoUpper === "NO" || textoUpper === "N" ) {
                            
                            console.log(`🔄 Posible respuesta de confirmación: ${text}`);
                            
                            try {
                                const response = await axios.post(
                                    'http://localhost:8000/whatsapp/message',
                                    {
                                        id: require('crypto').randomUUID(),
                                        account_id: 1,
                                        phone_number: 'whatsapp_bot',
                                        sender: sender,
                                        chat_id: remoteJid,
                                        timestamp: Date.now(),
                                        type: 'text',
                                        text: textoUpper,
                                        image_base64: null,
                                        caption: null,
                                        mimetype: null,
                                        size: 0
                                    },
                                    { 
                                        timeout: 60000,
                                        headers: { 'Content-Type': 'application/json' }
                                    }
                                );
                                
                                console.log('✅ Respuesta de Python-confirmacion:', response.data);
                                
                                // Enviar respuesta al usuario
                                if (response.data?.reply) {
                                    await sock.sendMessage(remoteJid, {
                                        text: response.data.reply
                                    });
                                }
                                continue;
                                // No tiene confirmación pendiente, continuar con flujo normal
                            } catch (error) {
                                console.error('❌ Error verificando confirmación:', error.message);
                                // Continuar con flujo normal
                            }
                        }
                        // Ya tiene DNI registrado → solicitar foto
                        console.log(`✅ Cliente ya registrado con DNI: ${checkSender.data.dni}`);
                        await sock.sendMessage(remoteJid, {
                            text: '📸 Estamos listos para recibir la foto de tu acta.'
                        });
                    } else if (msg.message?.imageMessage) {
                        console.log('📸 Procesando imagen...');
                        
                        try {
                            // Descargar imagen usando el método correcto
                            const { downloadContentFromMessage } = require('@whiskeysockets/baileys');
                            
                            const stream = await downloadContentFromMessage(msg.message.imageMessage, 'image');
                            let imageBuffer = Buffer.from([]);
                            
                            for await (const chunk of stream) {
                                imageBuffer = Buffer.concat([imageBuffer, chunk]);
                            }
                            
                            if (!imageBuffer || imageBuffer.length === 0) {
                                console.error('❌ No se pudo descargar la imagen');
                                await sock.sendMessage(remoteJid, {
                                    text: '❌ Error al procesar la imagen. Por favor intenta nuevamente.'
                                });
                                continue;
                            }
                            
                            console.log(`✅ Imagen descargada: ${imageBuffer.length} bytes`);
                            
                            // Convertir a Base64
                            const imageBase64 = imageBuffer.toString('base64');
                            const caption = msg.message.imageMessage.caption || '';
                            
                            // Enviar imagen + caption a Python
                            const response = await axios.post(
                                'http://localhost:8000/whatsapp/message',
                                {
                                    id: require('crypto').randomUUID(),
                                    account_id: 1,
                                    phone_number: 'whatsapp_bot',
                                    sender: sender,
                                    chat_id: remoteJid,
                                    timestamp: Date.now(),
                                    type: 'image',
                                    image_base64: imageBase64,
                                    caption: caption,
                                    mimetype: msg.message.imageMessage.mimetype || 'image/jpeg',
                                    size: imageBuffer.length
                                },
                                { 
                                    timeout: 60000,
                                    headers: { 'Content-Type': 'application/json' }
                                }
                            );
                            
                            console.log('✅ Respuesta de Python:', response.data);
                            
                            // Enviar respuesta al usuario
                            if (response.data?.reply) {
                                await sock.sendMessage(remoteJid, {
                                    text: response.data.reply
                                });
                            }
                            
                        } catch (error) {
                            console.error('❌ Error procesando imagen:', error);
                            await sock.sendMessage(remoteJid, {
                                text: '⚠️ Error procesando tu imagen. Por favor intenta nuevamente.'
                            });
                        }
                        continue; // Ya procesamos la imagen, saltamos al siguiente mensaje
                    }  else {
                        
                        if (/^\d{8}$/.test(text.trim())) {
                            let nombresCompletos = null;
                            let nombreCorto = null;
                            let errorFactiliza = false;
                            const dni = text.trim();
                            console.log(`🆔 Cliente ${sender} envió DNI: ${dni}`);
                            try {
                                // Pequeña pausa
                                await new Promise(resolve => setTimeout(resolve, 1000));

                                const factilizaUrl = `https://api.factiliza.com/v1/dni/info/${dni}`;
                                const factilizaResponse = await axios.get(factilizaUrl, {
                                    headers: {
                                        'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI1MDIiLCJodHRwOi8vc2NoZW1hcy5taWNyb3NvZnQuY29tL3dzLzIwMDgvMDYvaWRlbnRpdHkvY2xhaW1zL3JvbGUiOiJjb25zdWx0b3IifQ.7tC_aaAC5yONdS59UZF45Ffn6UUiyvUclaDMH4JLQgM'
                                    },
                                    timeout: 8000
                                });

                                // 🔥 Extraer datos según la estructura proporcionada
                                if (factilizaResponse.data?.success && factilizaResponse.data?.data) {
                                    const data = factilizaResponse.data.data;
                                    const nombres = data.nombres || '';
                                    const apellidoPaterno = data.apellido_paterno || '';
                                    const apellidoMaterno = data.apellido_materno || '';
                                    
                                    // Nombre completo para guardar en BD
                                    nombresCompletos = `${apellidoPaterno} ${apellidoMaterno}, ${nombres}`.trim();
                                    
                                    // Nombre corto para el saludo (ej: "Orlando Oswaldo")
                                    const primerNombre = nombres.split(' ')[0] || '';
                                    nombreCorto = `${primerNombre} ${apellidoPaterno}`.trim();
                                    
                                    console.log(`✅ Datos obtenidos de Factiliza: ${nombresCompletos}`);
                                } else {
                                    console.warn('⚠️ Factiliza no devolvió datos para el DNI:', dni);
                                }
                            } catch (factilizaError) {
                                console.error('❌ Error consultando Factiliza:', factilizaError.message);
                                errorFactiliza = true;
                            }

                            try {
                                // Enviar DNI a Python para registrar
                                const response = await axios.post(
                                    'http://localhost:8000/whatsapp/register-dni',
                                    {
                                        sender: sender,
                                        dni: dni,
                                        nombre: nombreCorto || 'Personero', // Usar nombre corto o "Personero" si no se obtuvo
                                        chat_id: remoteJid,
                                        timestamp: Date.now()
                                    },
                                    { timeout: 10000 }
                                );
                                
                                console.log('✅ Respuesta de registro:', response.data);
                                
                                if (response.data?.success) {
                                    // Registro exitoso → solicitar foto
                                    if (response.data.exists) {
                                        // Cliente ya existente
                                        await sock.sendMessage(remoteJid, {
                                            text: `✅ Bienvenido ${nombreCorto || 'Personero'} \n Estamos listos para recibir la foto de tu acta.`
                                        });
                                    } else {
                                        // Registro exitoso
                                        await sock.sendMessage(remoteJid, {
                                            text: `✅ Bienvenido ${nombreCorto || 'Personero'} \n Estamos listos para recibir la foto de tu acta.`
                                        });
                                    }
                                } else {
                                    // Error en registro
                                    await sock.sendMessage(remoteJid, {
                                        text: response.data?.message || '❌ Error al registrar tu DNI. Por favor intenta nuevamente.'
                                    });
                                }
                            } catch (error) {
                                console.error('❌ Error registrando DNI:', error.message);
                                await sock.sendMessage(remoteJid, {
                                    text: '⚠️ Error al procesar tu DNI. Por favor intenta más tarde.'
                                });
                            }
                            continue; // Saltar al siguiente mensaje
                        }else if(! msg.message?.imageMessage){
                            // No tiene DNI → solicitar DNI
                            console.log(`❌ Cliente NO registrado, solicitando DNI...`);
                            await sock.sendMessage(remoteJid, {
                                text: 'Bienvenido señor personero al CNP, \n por favor escribir su numero de DNI: \n  '
                            });
                           
                        }
                        continue;
                        
                    }
                } catch (error) {
                    console.error('❌ Error verificando en Redis:', error.message);
                    await sock.sendMessage(remoteJid, {
                        text: '⚠️ Error al verificar tu información. Por favor intenta más tarde. ' + error.message
                    });
                }
                // 🔥 NUEVO: Manejar mensajes con IMAGEN
                
                
                

                

                
            }
        });


    } catch (error) {
        console.error('❌ Error al conectar:', error);
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            console.log(`🔄 Reintentando en 5 segundos (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
            setTimeout(() => connectToWhatsApp(), 5000);
        }
    }
}

// Endpoint para obtener estado de conexión
app.get('/status', (req, res) => {
    res.json({
        connected: isConnected,
        hasQR: qrCodeData !== null,
        reconnectAttempts
    });
});

// Endpoint para obtener código QR
app.get('/qr', (req, res) => {
    if (qrCodeData) {
        res.json({ 
            qr: qrCodeData,
            message: 'Escanea este código QR con WhatsApp'
        });
    } else if (isConnected) {
        res.json({ 
            connected: true,
            message: 'Ya está conectado a WhatsApp' 
        });
    } else {
        res.json({ 
            message: 'Esperando código QR... Verifica la consola del servidor'
        });
    }
});

// Endpoint para reiniciar conexión
app.post('/restart', async (req, res) => {
    try {
        console.log('🔄 Reiniciando conexión...');
        if (sock) {
            await sock.logout().catch(() => {})
            sock.end();
            sock = null;
        }
        // 2️⃣ Eliminar carpeta auth_info (sesión)
        if (fs.existsSync(AUTH_FOLDER)) {
            console.log('🧹 Eliminando carpeta auth_info...')
            fs.rmSync(AUTH_FOLDER, { recursive: true, force: true })
        }
        reconnectAttempts = 0;
        setTimeout(() => connectToWhatsApp(), 3000);
        res.json({ success: true, message: 'Reiniciando conexión' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint para enviar mensaje a un número
app.post('/send-message', async (req, res) => {
    try {
        if (!isConnected) {
            return res.status(400).json({ 
                error: 'WhatsApp no está conectado',
                suggestion: 'Verifica el estado con GET /status'
            });
        }

        const { number, message } = req.body;
        
        if (!number || !message) {
            return res.status(400).json({ 
                error: 'Se requiere número y mensaje',
                example: {
                    number: '51987654321',
                    message: 'Tu mensaje aquí'
                }
            });
        }

        // Formatear número (agregar @s.whatsapp.net)
        let formattedNumber = number.replace(/[^0-9]/g, '');
        formattedNumber = formattedNumber.includes('@s.whatsapp.net') 
            ? formattedNumber 
            : `${formattedNumber}@s.whatsapp.net`;

        console.log(`📤 Enviando mensaje a ${number}...`);
        await sock.sendMessage(formattedNumber, { text: message });
        console.log(`✅ Mensaje enviado a ${number}`);
        
        res.json({ 
            success: true, 
            message: `Mensaje enviado a ${number}`,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error al enviar mensaje:', error);
        res.status(500).json({ 
            success: false,
            error: 'Error al enviar mensaje', 
            details: error.message 
        });
    }
});

// Endpoint para enviar mensajes a múltiples números
app.post('/send-bulk', async (req, res) => {
    try {
        if (!isConnected) {
            return res.status(503).json({ 
                status: 'error',
                message: 'WhatsApp no está conectado. Por favor, escanea el QR.',
                details: null 
            });
        }

        const { message, contacts, delay = 1000 } = req.body;
        
        if (!contacts || !Array.isArray(contacts) || !message) {
            return res.status(400).json({ 
                status: 'error',
                message: 'Parámetros requeridos no válidos. Se espera message y contacts (array de objetos).',
                example: {
                    message: 'Hola #NOMBRE#, tu código es 123.',
                    contacts: [{ numero: '51987654321', nombre: 'Juan' }],
                    delay: 1000
                }
            });
        }

        const results = [];
        const totalCount = contacts.length; // Usamos totalCount para el conteo final
        console.log(`📤 Iniciando envío masivo a ${totalCount} contactos...`);
        
        for (let i = 0; i < totalCount; i++) {
            const contact = contacts[i];
            const number = contact.numero;
            // Usar 'Cliente' si el nombre es nulo o vacío, como se definió en Python
            const name = contact.nombre || 'Cliente'; 
            let formattedNumber = ''; 
            try {
                // 2. PERSONALIZACIÓN DEL MENSAJE
                // Reemplazar el placeholder #NOMBRE# con el nombre real del contacto
                // Se usa una expresión regular global (/g) para reemplazar todas las ocurrencias.
                const personalizedMessage = message.replace(/#NOMBRE#/g, name);
                formattedNumber = number.replace(/[^0-9]/g, '');
                formattedNumber = formattedNumber.includes('@s.whatsapp.net') 
                    ? formattedNumber 
                    : `${formattedNumber}@s.whatsapp.net`;

                // 3. ENVIAR MENSAJE PERSONALIZADO
                await sock.sendMessage(formattedNumber, { text: personalizedMessage });
                
                results.push({ 
                    number: contact.numero,
                    success: true, 
                    message: `Mensaje enviado. Nombre usado: ${name}`
                });
                console.log(`✅ [${i + 1}/${contacts.length}] Enviado a ${name} (${number}).`);
                
                // 4. Esperar entre mensajes (Delay)
                if (i < contacts.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            } catch (error) {
                console.error(`❌ Error al enviar mensaje a ${number}:`, error.message);
                results.push({ 
                    number: contact.numero, 
                    success: false, 
                    error: error.message 
                });
            }
        }
        
        const successCount = results.filter(r => r.success).length;
        console.log(`✅ Proceso completado: ${successCount}/${contacts.length} exitosos`);
        
        res.json({ 
            success: true,
            total: contacts.length,
            successful: successCount,
            failed: contacts.length - successCount,
            results 
        });
    } catch (error) {
        console.error('❌ Error al enviar mensajes:', error);
        res.status(500).json({ 
            success: false,
            error: 'Error al enviar mensajes', 
            details: error.message 
        });
    }
});

// Endpoint para enviar mensajes individuales
app.post('/send', async (req, res) => {
    try {
        if (!isConnected) {
            return res.status(503).json({ 
                status: 'error',
                message: 'WhatsApp no está conectado. Por favor, escanea el QR.',
                details: null 
            });
        }

        const { message, contacto } = req.body;
        
        if (!contacto?.numero || !message) {
            return res.status(400).json({ 
                status: 'error',
                message: 'Parámetros requeridos no válidos. Se espera message y contacto (objeto con numero y nombre).',
                example: {
                    message: 'Hola #NOMBRE#, tu código es 123.',
                    contacto: { numero: '987654321', nombre: 'Juan' }
                }
            });
        }

        
        
        console.log(`📤 Iniciando envío a ${contacto.numero} ...`);
        
        // 2. PERSONALIZACIÓN DEL MENSAJE
        // Reemplazar el placeholder #NOMBRE# con el nombre real del contacto
        // Se usa una expresión regular global (/g) para reemplazar todas las ocurrencias.
        const name = contacto.nombre || 'Cliente';
        const personalizedMessage = message.replace(/#NOMBRE#/g, name);
        
        
        let formattedNumber = contacto.numero.replace(/\D/g, '');

        if (formattedNumber.length === 9) {
            formattedNumber = '51' + formattedNumber;
        }
            if (!/^51\d{9}$/.test(formattedNumber)) {
            return res.status(400).json({
                status: 'error',
                message: 'Número inválido después de validación'
            });
        }
        formattedNumber = formattedNumber.includes('@s.whatsapp.net') 
            ? formattedNumber 
            : `${formattedNumber}@s.whatsapp.net`;

        if (!formattedNumber) {
            return res.status(400).json({
                status: 'error',
                message: 'Número inválido después de validación'
            });
        }
        // 3. ENVIAR MENSAJE PERSONALIZADO
        await sock.sendMessage(formattedNumber, { text: personalizedMessage });
        
        console.log(`✅ [${now()}] Mensaje enviado a ${name} (${contacto.numero})`);

        return res.json({
            success: true,
            number: contacto.numero,
            nameUsed: name,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error(`❌ Error al enviar mensaje a ${req.body?.contacto?.numero}:`, error.message);
        return res.status(500).json({
            success: false,
            message: 'Error al enviar mensaje',
            details: error.message
        });
    }
        
});
function now() {
    return new Date().toLocaleTimeString('es-PE', {
        hour12: false
    });
}
// Endpoint para cerrar sesión y limpiar
app.post('/logout', async (req, res) => {
    try {
        if (sock) {
            await sock.logout();
            isConnected = false;
            qrCodeData = null;
            
            // Eliminar carpeta de autenticación
            if (fs.existsSync(authFolder)) {
                fs.rmSync(authFolder, { recursive: true, force: true });
                console.log('🗑️  Sesión eliminada');
            }
            
            res.json({ 
                success: true, 
                message: 'Sesión cerrada. Reinicia el servidor para conectar nuevamente.' 
            });
        } else {
            res.json({ message: 'No había conexión activa' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Endpoint de salud
app.get('/health', (req, res) => {
    res.json({
        status: 'running',
        connected: isConnected,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log('\n========================================');
    console.log('🚀 SERVIDOR WHATSAPP BOT INICIADO');
    console.log('========================================');
    console.log(`📡 Puerto: ${PORT}`);
    console.log(`🔗 URL: http://localhost:${PORT}`);
    console.log('========================================\n');
    
    console.log('📋 Endpoints disponibles:');
    console.log(`  GET  /status       - Ver estado de conexión`);
    console.log(`  GET  /qr           - Obtener código QR`);
    console.log(`  POST /send-message - Enviar mensaje individual`);
    console.log(`  POST /send-bulk    - Enviar mensajes masivos`);
    console.log(`  POST /restart      - Reiniciar conexión`);
    console.log(`  POST /logout       - Cerrar sesión`);
    console.log(`  GET  /health       - Estado del servidor\n`);
    
    connectToWhatsApp();
});

process.on('unhandledRejection', (err) => {
    console.error('❌ Error no manejado:', err);
});