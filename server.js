
// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const bwipjs = require('bwip-js'); // Dependencia para generar códigos de barras y QR
const { createClient } = require('@supabase/supabase-js');

// --- Configuración de Middlewares ---
const app = express();
app.use(cors({ origin: 'http://localhost:5173' })); // Cambia el puerto si es necesario
app.use(express.json());

// --- Inicialización de Clientes ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASSWORD,
    },
});

// =================================================================
// FUNCIÓN PARA GENERAR EL PDF (CON CÓDIGO DE BARRAS Y QR)
// =================================================================

function generarRecetaPDF(recetaData) {
    // La función ahora es asíncrona por dentro para usar await con bwip-js
    return new Promise(async (resolve, reject) => {
        try {
            // El contenido del código de barras es el 'numero_recibo'.
            // Usamos el ID de la receta como fallback para no romper la funcionalidad si falta.
            const barcodeText = recetaData.numero_recibo || recetaData.id.substring(0, 12).toUpperCase();

            // --- Generar buffers para código de barras y QR ---
            const barcodeBuffer = await bwipjs.toBuffer({
                bcid: 'code128',
                text: barcodeText,
                scale: 3,
                height: 10,
                includetext: true,
                textxalign: 'center',
            });

            const qrCodeBuffer = await bwipjs.toBuffer({
                bcid: 'qrcode',
                text: 'https://carelux.netlify.app/',
                scale: 3,
            });

            // Habilitar bufferPages es clave para poder modificar páginas anteriores (ej. pie de página)
            const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true }); 
            const buffers = [];
            
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                const pdfData = Buffer.concat(buffers);
                resolve(pdfData);
            });

            // --- helpers de formato ---
            const formatDateShort = (dateString) => {
                if (!dateString) return 'N/A';
                const date = new Date(dateString);
                return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
            };

            // --- Definición de Layout ---
            const margin = 40;
            const contentWidth = doc.page.width - 2 * margin;
            const leftColumnWidth = contentWidth * 0.55;
            const rightColumnWidth = contentWidth * 0.45 - 10;
            const leftColumnX = margin;
            const rightColumnX = margin + leftColumnWidth + 10;
            
            let yLeft = margin;
            let yRight = margin;
            
            // ============================
            // SECCIÓN SUPERIOR
            // ============================

            // --- Columna Izquierda Superior ---
            doc.font('Helvetica').fontSize(8).text('POWERED BY CYNOSURE', leftColumnX, yLeft);
            yLeft += 12;
            doc.font('Helvetica').fontSize(10).text('DIRECCIÓN DE SALUD CARELUX', leftColumnX, yLeft);
            yLeft += 15;
            doc.font('Helvetica-Bold').fontSize(10).text('RECETA INDIVIDUAL', leftColumnX, yLeft);
            yLeft = doc.y + 10;

            if (recetaData.farmacia_info?.nombre) {
                doc.font('Helvetica-Bold').fontSize(9).text('Farmacia de Emisión:', leftColumnX, yLeft);
                yLeft = doc.y;
                doc.font('Helvetica').fontSize(8);
                doc.text(`Nombre: ${recetaData.farmacia_info.nombre}`, leftColumnX + 5, yLeft, { width: leftColumnWidth - 5 });
                if (recetaData.farmacia_info.ubicacion) doc.text(`Ubicación: ${recetaData.farmacia_info.ubicacion}`, { indent: 5, width: leftColumnWidth - 5 });
                if (recetaData.farmacia_info.telefono) doc.text(`Teléfono: ${recetaData.farmacia_info.telefono}`, { indent: 5, width: leftColumnWidth - 5 });
                yLeft = doc.y + 10;
            }

            doc.font('Helvetica-Bold').fontSize(9).text('PACIENTE', leftColumnX, yLeft);
            doc.font('Helvetica').fontSize(9).text(recetaData.paciente_nombre || 'N/A', leftColumnX, doc.y, { width: leftColumnWidth });
            yLeft = doc.y + 10;

            const addVital = (label, value, unit = '') => {
                if (value !== null && value !== undefined && String(value).trim() !== '') {
                    doc.font('Helvetica-Bold').fontSize(8).text(`${label}:`, leftColumnX, yLeft, { continued: true });
                    doc.font('Helvetica').text(` ${value}${unit}`);
                    yLeft = doc.y;
                }
            };
            addVital('Temperatura', recetaData.temperatura_corporal, ' °C');
            addVital('Frec. Cardíaca', recetaData.frecuencia_cardiaca, ' lpm');
            addVital('Frec. Respiratoria', recetaData.frecuencia_respiratoria, ' rpm');
            addVital('Tensión Arterial', recetaData.tension_arterial, ' mmHg');
            addVital('Peso', recetaData.peso, ' kg');
            addVital('Altura', recetaData.altura, ' cm');
            if(recetaData.imc) addVital('IMC', recetaData.imc.toFixed(2), ' kg/m²');
            addVital('Tipo de Sangre', recetaData.blood_type);
            addVital('Alergias', recetaData.allergies);

            // --- Columna Derecha Superior ---
            doc.font('Helvetica').fontSize(9);
            doc.text(`Dr. ${recetaData.doctor_nombre || 'N/A'}`, rightColumnX, yRight, { width: rightColumnWidth });
            doc.text('Medicina general', { width: rightColumnWidth });
            if (recetaData.doctor_cedula) doc.text(`Cédula Prof: ${recetaData.doctor_cedula}`, { width: rightColumnWidth });
            yRight = doc.y + 5;

            doc.font('Helvetica').fontSize(8).text('Fecha de la prescripción:', rightColumnX, yRight);
            doc.font('Helvetica-Bold').text(formatDateShort(recetaData.fecha_emision), rightColumnX, doc.y);
            yRight = doc.y + 5;

            if (recetaData.estado_dispensacion) {
                doc.font('Helvetica').fontSize(8).text('Estado Dispensación:', rightColumnX, yRight);
                doc.font('Helvetica').text(recetaData.estado_dispensacion, rightColumnX, doc.y);
                yRight = doc.y + 5;
            }
            
            yRight = doc.y + 10;
            // --- CAMBIO: Se eliminan las rayas que simulaban un código de barras ---

            // --- CAMBIO: Insertar código de barras generado ---
            const barcodeWidth = rightColumnWidth * 0.9;
            const barcodeX = rightColumnX + (rightColumnWidth - barcodeWidth) / 2;
            doc.image(barcodeBuffer, barcodeX, yRight, {
                width: barcodeWidth
            });
            const barcodeImageHeight = 45; // Altura estimada en puntos del código de barras con texto
            const barcodeAreaBottomY = yRight + barcodeImageHeight;
            
            // ============================
            // ÁREA DE CONTENIDO PRINCIPAL
            // ============================
            let startContentY = Math.max(yLeft, barcodeAreaBottomY) + 20; // Ajustar el inicio del contenido
            doc.moveTo(margin, startContentY).lineTo(doc.page.width - margin, startContentY).stroke();
            
            startContentY += 10;
            let currentLeftY = startContentY;
            let currentRightY = startContentY;

            // --- Prescripción (Columna Izquierda) ---
            doc.font('Helvetica-Bold').fontSize(10).text('PRESCRIPCIÓN', leftColumnX, currentLeftY);
            currentLeftY = doc.y + 5;
            
            const medicamentos = Array.isArray(recetaData.medicamentos) ? recetaData.medicamentos : [];
            if (medicamentos.length > 0) {
                medicamentos.forEach((med, index) => {
                    doc.font('Helvetica-Bold').fontSize(9).text(`${index + 1}. ${med.nombre || 'N/A'}`, leftColumnX, currentLeftY, { width: leftColumnWidth });
                    
                    const details = [med.dosis, med.frecuencia, med.duracion].filter(Boolean).join(' / ');
                    doc.font('Helvetica').fontSize(9).text(details, { width: leftColumnWidth, indent: 10 });
                    
                    doc.font('Helvetica').fontSize(8).text('Núm. envases / unidades:', { continued: true, indent: 10 });
                    doc.rect(doc.x + 5, doc.y - 2, 8, 8).stroke();
                    currentLeftY = doc.y + 15;
                });
            }

            // --- Información Clínica (Columna Derecha) ---
            const addRightBlock = (label, value) => {
                if (value) {
                    doc.font('Helvetica-Bold').fontSize(9).text(`${label}:`, rightColumnX, currentRightY, { continued: true });
                    doc.font('Helvetica').text(` ${value}`);
                    currentRightY = doc.y + 5;
                }
            };
            
            doc.font('Helvetica-Bold').fontSize(10).text('Información Clínica', rightColumnX, currentRightY);
            currentRightY = doc.y + 5;
            addRightBlock('Motivo de Consulta', recetaData.motivo_consulta);
            addRightBlock('Antecedentes', recetaData.antecedentes);
            addRightBlock('Diagnóstico', recetaData.diagnostico);
            addRightBlock('Exploración Física', recetaData.exploracion_fisica);
            addRightBlock('Plan de Tratamiento', recetaData.plan_tratamiento);

            doc.font('Helvetica-Bold').fontSize(10).text('Información al Farmacéutico, en su caso', rightColumnX, doc.y + 5);
            currentRightY = doc.y + 5;
            addRightBlock('Indicaciones', recetaData.indicaciones);
            addRightBlock('Recomendaciones', recetaData.recomendaciones);
            addRightBlock('Observaciones', recetaData.observaciones);

            let endContentY = Math.max(currentLeftY, currentRightY);
            doc.moveTo(leftColumnX + leftColumnWidth + 5, startContentY - 10).lineTo(leftColumnX + leftColumnWidth + 5, endContentY).stroke();

            // ============================
            // SECCIONES INFERIORES Y MANEJO DE PÁGINA
            // ============================
            let currentY = endContentY + 10;
            
            const checkPageBreak = (neededHeight) => {
                // El contenido no debe invadir el área de la firma, que está a 130pt del fondo
                if (doc.y + neededHeight > doc.page.height - 130) {
                    doc.addPage();
                    currentY = margin;
                } else {
                    currentY = doc.y;
                }
            };

            if (recetaData.proxima_consulta) {
                checkPageBreak(30);
                doc.font('Helvetica-Bold').fontSize(10).text(`Próxima Consulta: ${formatDateShort(recetaData.proxima_consulta)}`, leftColumnX, currentY);
                currentY = doc.y + 15;
            }

            const hasDispensationInfo = recetaData.estado_dispensacion || recetaData.fecha_dispensacion || recetaData.medicamentos_dispensados_detalle;
            if(hasDispensationInfo) {
                checkPageBreak(80);
                doc.font('Helvetica-Bold').fontSize(12).text('Información de Dispensación', leftColumnX, currentY);
                currentY = doc.y + 10;

                if(recetaData.estado_dispensacion) {
                    doc.font('Helvetica-Bold').fontSize(9).text('Estado:', leftColumnX, currentY, { continued: true });
                    doc.font('Helvetica').text(` ${recetaData.estado_dispensacion}`);
                    currentY = doc.y + 5;
                }

                doc.font('Helvetica-Bold').fontSize(9).text('Detalle de Medicamentos Dispensados:', leftColumnX, currentY);
                doc.font('Helvetica').text(recetaData.medicamentos_dispensados_detalle || 'No hay detalles de medicamentos dispensados.', { indent: 5 });
                currentY = doc.y + 20;
            }
            
            // --- CAMBIO: Ajustar posición de la firma para no chocar con el nuevo pie de página ---
            const signatureY = Math.max(currentY, doc.page.height - 130);
            doc.moveTo(doc.page.width - margin - 150, signatureY).lineTo(doc.page.width - margin, signatureY).stroke();
            doc.font('Helvetica').fontSize(10).text(`Dr(a). ${recetaData.doctor_nombre}`, doc.page.width - margin - 150, signatureY + 5, { width: 150, align: 'center' });

            // --- CAMBIO: Pie de Página rediseñado con leyenda y QR ---
            const range = doc.bufferedPageRange();
            for (let i = range.start; i < range.start + range.count; i++) {
                doc.switchToPage(i);
                
                const footerY = doc.page.height - margin - 50; // Posición vertical del pie de página
                const qrSize = 50;
                const qrX = doc.page.width - margin - qrSize;
                
                // Dibujar QR a la derecha
                doc.image(qrCodeBuffer, qrX, footerY, {
                    fit: [qrSize, qrSize]
                });
                
                // Dibujar leyenda a la izquierda
                const legendWidth = contentWidth - qrSize - 20; // Ancho del texto
                doc.font('Helvetica').fontSize(8).text(
                    'Esta es una receta generada digitalmente. Puedes consultar su autenticidad y detalle en el portal web o la aplicación móvil de la farmacia.',
                    margin,
                    footerY + 10,
                    { 
                      width: legendWidth,
                      align: 'left'
                    }
                );
            }

            doc.end();

        } catch (error) {
            console.error("Error en generarRecetaPDF:", error);
            reject(error);
        }
    });
}

// --- Endpoint Principal ---
app.post('/api/crear-y-enviar-receta', async (req, res) => {
    try {
        const { recetaData, paciente, doctor } = req.body;
        if (!recetaData || !paciente || !doctor || !paciente.email) {
            return res.status(400).json({ message: "Datos incompletos para procesar la receta o enviar el correo." });
        }
        
        const dbRecetaData = { ...recetaData, paciente_id: paciente.id, doctor_id: doctor.id };
        
        const { data: recetaCreada, error: insertError } = await supabase.from('recetas').insert([dbRecetaData]).select().single();
        if (insertError) throw insertError;
        console.log(`Receta guardada con ID: ${recetaCreada.id}`);
        
        console.log("Generando PDF de la receta...");
        // Pasamos el numero_recibo a la función de PDF a través de recetaCreada
        const pdfBuffer = await generarRecetaPDF({
            ...recetaCreada,
            paciente_nombre: paciente.name,
            doctor_nombre: doctor.nombre,
            doctor_cedula: doctor.cedula_prof,
            // Asegurarse de que la farmacia info se pase si existe
            farmacia_info: recetaData.farmacia_info
        });
        console.log("PDF de la receta generado exitosamente.");

        console.log(`Enviando correo con la receta a: ${paciente.email}...`);
        const mailOptions = {
            from: `"Recetas de Carelux" <${process.env.EMAIL_USER}>`,
            to: paciente.email,
            subject: `Tu Receta Médica - ${paciente.name}`,
            html: `
                    <p>Hola ${paciente.name},</p>
                    <p>Adjunto a este correo encontrarás una copia de tu receta médica generada por el Dr(a). ${doctor.nombre}.</p>

                    <p>¿Quieres obtener una experiencia más completa?</p>
                    <p>
                        <a href="https://carelux.netlify.app/" target="_blank" style="color: #007bff; text-decoration: none; font-weight: bold;">
                        Regístrate como paciente y vive una experiencia más real
                        </a>
                    </p>

                    <p>
                        <img src="https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExZjB6NWs2cnZsNWk4Y3BrdDJyZDNqaTB3eXMyd2dpaXdkYmVxNnd0bCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/MRS3jjjxU8SdXHHglm/giphy.gif" alt="Carelux Experience" style="max-width: 100%; height: auto;" />
                    </p>

                    <p>Atentamente,<br><strong>Carelux Point</strong></p>
                    <p style="font-size: 0.8em; color: #777;">Powered By Cynosure 2025.</p>
                    `,
            attachments: [{ filename: `receta-${recetaCreada.id}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }],
        };

        await transporter.sendMail(mailOptions);
        console.log("Correo de la receta enviado con éxito.");

        res.status(200).json({ message: 'Receta creada y enviada por correo al paciente.', recetaId: recetaCreada.id });

    } catch (error) {
        console.error("Error en el proceso de creación/envío de receta:", error);
        res.status(500).json({ message: error.message || "Error interno del servidor al procesar la receta." });
    }
});

// --- Iniciar el Servidor ---
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🚀 Servidor Backend escuchando en http://localhost:${PORT}`);
});
