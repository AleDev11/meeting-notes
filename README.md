<img src="resources/icon.png" width="88" alt="">

# Meeting Notes

[![CI](https://github.com/AleDev11/meeting-notes/actions/workflows/ci.yml/badge.svg)](https://github.com/AleDev11/meeting-notes/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/AleDev11/meeting-notes)](https://github.com/AleDev11/meeting-notes/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Aplicación de escritorio para Windows que transcribe reuniones de cualquier aplicación (Teams, Google Meet, Zoom,
Discord…), separa a cada persona que habla, permite tomar notas por secciones y genera un acta con IA.

## Características

- **Captura** del micrófono y del audio del sistema (loopback de Windows), sin depender de la aplicación de la llamada.
- **Tu voz aparte**: el micrófono y el audio de la llamada se graban y transcriben por separado, así que lo que dices
  tú siempre sale con tu nombre y el resto se separa en Persona 1, 2, 3… Si usas altavoces, el eco de los demás que
  recoge el micrófono se descarta. Se puede desactivar en reuniones presenciales.
- **Varios idiomas**: la reunión puede pasar del español al inglés o al catalán y cada parte se transcribe en su
  idioma.
- **Transcripción en vivo** con Deepgram (con separación de hablantes) o ElevenLabs `scribe_v2_realtime`.
- **Pasada final** al detener la grabación con ElevenLabs Scribe v2, AssemblyAI o Deepgram. Los nombres asignados
  en directo se conservan.
- **Control durante la grabación**: pausar, silenciar tu micrófono o el audio de la reunión, y un modo mini con una
  ventana flotante que muestra la transcripción en directo.
- **Escuchar la grabación** desde cualquier frase de la transcripción y corregir el texto a mano.
- **Vocabulario** propio (nombres, productos, siglas) para que se reconozca correctamente.
- **Gestión de hablantes**: renombrar, fusionar, reasignar turnos y deducir nombres a partir de la conversación.
- **Notas** por secciones reordenables, con marcas de tiempo (`Ctrl+T`) durante la grabación.
- **Resúmenes** con Claude u OpenAI a partir de plantillas de prompt editables.
- **Actualizaciones automáticas**: las versiones nuevas se descargan en segundo plano y se instalan al reiniciar.
- **Biblioteca local** en carpetas anidadas. Nada sale del equipo salvo las llamadas a los proveedores que elijas.

## Requisitos

- Windows 10 u 11
- [Bun](https://bun.sh) y Node.js 24 o superior
- API key de al menos un proveedor de transcripción (Deepgram, ElevenLabs o AssemblyAI) y, para los resúmenes,
  de Anthropic u OpenAI

## Instalación

Descarga el instalador desde la [última release](https://github.com/AleDev11/meeting-notes/releases/latest).
Todavía no está firmado, así que Windows SmartScreen mostrará un aviso la primera vez. Después, la app se
actualiza sola.

### Desde el código

```bash
git clone https://github.com/AleDev11/meeting-notes.git
cd meeting-notes
bun install
bun run dev
```

Para generar el instalador en local:

```bash
bun run dist
```

## Configuración

Las API keys se añaden desde **Configuración > API keys** y se guardan cifradas con `safeStorage` (DPAPI en
Windows). Como alternativa, puedes copiar `.env.example` a `.env.local`; la app usa esos valores para las keys que
no estén configuradas.

Las reuniones se guardan en `%APPDATA%/meeting-notes/library`.

## Estructura

```
src/main/            proceso principal de Electron
  transcription/     proveedores: deepgram, elevenlabs, assemblyai
  speakers.ts        registro de hablantes, fusiones y alineación en vivo/final
  summarize.ts       resúmenes y deducción de nombres
  store.ts           biblioteca en disco
src/preload/         puente IPC
src/renderer/        interfaz en React
src/shared/          tipos y tarifas compartidos
```

## Contribuir

Consulta [CONTRIBUTING.md](CONTRIBUTING.md). Para vulnerabilidades, [SECURITY.md](SECURITY.md).

## Licencia

[MIT](LICENSE)
