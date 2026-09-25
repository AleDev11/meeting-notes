# Contribuir

Gracias por el interés en el proyecto.

## Entorno

Requisitos: Windows 10/11, [Bun](https://bun.sh) y Node.js 24 o superior.

```bash
bun install
bun run dev
```

Para probar la transcripción necesitas al menos una key de Deepgram o ElevenLabs. Puedes configurarla desde la
propia app o en `.env.local` (ver `.env.example`).

## Issues

- Antes de abrir una, busca si ya existe.
- Para errores, indica versión de Windows, proveedor de transcripción y pasos para reproducirlo.
- No pegues API keys ni transcripciones con datos sensibles.

## Pull requests

1. Haz un fork y crea una rama desde `main`.
2. Mantén los cambios acotados a un solo tema.
3. Comprueba que `bun run typecheck` pasa.
4. Describe qué cambia y cómo lo has probado.

Si el cambio es grande (un proveedor nuevo, cambios en el formato de la biblioteca), abre antes una issue para
comentarlo.

## Estilo

- TypeScript estricto, sin `any` salvo que no haya alternativa.
- La lógica que habla con APIs externas va en el proceso principal (`src/main`), nunca en el renderer.
- Los textos de la interfaz están en español.
