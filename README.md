# FISICOG AI

Chat web en español conectado a la API de Gemini, empaquetado con Vite y listo para desplegar en Vercel.

## Desarrollo y build

```bash
npm install
npm run dev
```

`npm run build` genera el sitio estático en `dist/`. Vercel detecta Vite automáticamente; usa `npm run build` y `dist` como directorio de salida.

## Configuración de Gemini

Copia `.env.example` a `.env` y configura:

- `VITE_USE_PUBLIC_AI_FLAG=true` junto con `VITE_GEMINI_API_KEY` para usar la clave configurada en el despliegue y ocultar el panel de clave del usuario. En este modo, el modelo se cambia desde el selector de la barra superior.
- `VITE_USE_PUBLIC_AI_FLAG=false` o sin clave pública para permitir que cada usuario introduzca la suya desde la interfaz.

Configura las mismas variables en Vercel antes de compilar. Las variables con prefijo `VITE_` se incluyen en el código enviado al navegador; una clave pública puede ser visible para los visitantes.

La app conserva el streaming de respuestas, KaTeX y los adjuntos PNG/JPG/WEBP, PDF y texto/código. Los archivos de texto se extraen en el navegador y las imágenes/PDF se envían como `inlineData`.
