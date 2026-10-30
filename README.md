# PhoGram

Aplicación Android de fotos y videos respaldada en Telegram. PhoGram organiza medios en álbumes, permite buscarlos, descargarlos y activar el respaldo automático desde el dispositivo.

## Descargar

La APK más reciente se publica en [GitHub Releases](https://github.com/wiwyzho001-jpg/TeleFotos/releases/latest) como `PhoGram.apk`. Para buscarla desde la app, abre **Ajustes de PhoGram → Actualizar aplicación → Buscar actualizaciones**. Android solicita confirmar la instalación.

## Desarrollo

Requisitos: Node.js 22, Rust estable con `aarch64-linux-android`, JDK 21, Android SDK 36 y NDK 28.2.13676358.

```sh
npm ci
npm run android:build -- --target aarch64 --apk
```

Los lanzamientos se publican al crear y subir una etiqueta `v*`, por ejemplo `v0.1.4`. GitHub Actions compila la APK y la adjunta al release con el nombre fijo `PhoGram.apk`, que usa el actualizador de Android.

## Licencia y origen

TeleFotos se basa en [TeleDrive](https://github.com/senapati484/teledrive) y conserva la licencia GPL-3.0 y sus atribuciones. Consulta [`LICENSE`](LICENSE) y [`TELEFOTOS.md`](TELEFOTOS.md).
