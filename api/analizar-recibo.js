// Función serverless de Vercel. Recibe una imagen en base64, la manda a la API
// de Claude (con la clave guardada de forma segura en el servidor, nunca en el
// navegador) y devuelve los datos del ticket/factura ya extraídos.

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Falta configurar ANTHROPIC_API_KEY en las variables de entorno de Vercel' });
  }

  const { imageBase64, mediaType } = req.body || {};
  if (!imageBase64) {
    return res.status(400).json({ error: 'Falta la imagen' });
  }

  const prompt = `Analiza esta imagen de un ticket o factura de gasto y responde SOLO con un JSON (sin texto adicional, sin markdown, sin explicación) con exactamente estos campos:
{
  "fecha_gasto": "YYYY-MM-DD, o null si no se distingue la fecha",
  "proveedor": "nombre del comercio o emisor de la factura",
  "concepto": "breve descripción de qué es el gasto, 2 a 6 palabras",
  "importe": numero total en euros con punto decimal y sin símbolo, ej: 45.30,
  "iva": numero del IVA si aparece desglosado, o null si no aparece,
  "categoria": una de estas exactamente: "Alquiler", "Suministros", "Material", "Formación", "Software", "Dietas/Manutención", "Regalos a pacientes", "Kit Digital", "Otros"
}

Nota: si el ticket es de un restaurante, bar o cafetería, clasifícalo como "Dietas/Manutención". Si es de un comercio y el concepto sugiere un regalo u obsequio, usa "Regalos a pacientes". Si tienes dudas, usa "Otros".`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: imageBase64 } },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Error llamando a la IA' });
    }

    const textBlock = (data.content || []).find((c) => c.type === 'text');
    if (!textBlock) {
      return res.status(500).json({ error: 'La IA no devolvió texto' });
    }

    const clean = textBlock.text.replace(/```json|```/g, '').trim();
    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (e) {
      return res.status(500).json({ error: 'No se pudo interpretar la respuesta de la IA', raw: textBlock.text });
    }

    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
