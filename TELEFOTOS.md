# TeleFotos

Fork de [TeleDrive v0.1.2](https://github.com/senapati484/teledrive/releases/tag/v0.1.2), commit `ce1a97b01a0582c3d6172f521896589b18609df9`. Conserva la licencia GPL-3.0 y los créditos del proyecto original. Rama: `codex/telefotos-android`.

## Estado

Prototipo Android instalable de la biblioteca de fotos. Reproduce una parte central de la experiencia de Google Fotos, pero aún no tiene paridad funcional completa. La APK ARM64 se compiló, verificó e instaló en el Moto Edge 60 Pro el 30 de octubre de 2026. La aplicación abre correctamente; se corrigió una biblioteca libsodium vacía que causaba el cierre al iniciar. Para mostrar la galería local, Android solicita permiso de fotos y permite limitar la selección.

Implementado en el código:

- Pantalla inicial de acceso a Telegram; al completar el acceso se abre `/photos`, con tema oscuro, barra flotante y colecciones. La ruta de Fotos requiere sesión.
- Galería de imágenes y videos ordenada por fecha, agrupación diaria, tamaños de cuadrícula y selección por elemento/día.
- Subida manual con el selector del sistema y la cola original de TeleDrive.
- Favoritos, archivo y papelera usando las acciones existentes del catálogo de Telegram.
- Álbumes sin duplicar archivos: `albumNames` se serializa con el catálogo original. La creación requiere seleccionar al menos una foto; no hay álbumes vacíos.
- Búsqueda textual por nombre, carpeta, álbum y fecha, tolerante a acentos.
- Visor de originales con navegación por flechas/deslizamiento, zoom por botón/doble toque, información, favoritos y descarga. Conversión HEIC para el visor.
- Miniaturas de Telegram cargadas al acercarse a la pantalla, con concurrencia limitada y caché persistente por cuenta (hasta 600 portadas). Las imágenes y videos nuevos compatibles generan un JPEG pequeño al subirlos. Para archivos antiguos sin portada se genera desde el original si pesa hasta 64 MiB, una descarga a la vez; los archivos mayores la generan al abrirse. Los originales no se modifican.
- Identidad Android independiente `com.telefotos.app`, nombre TeleFotos e icono suministrado por el usuario, con margen para el launcher adaptativo.
- Acceso local a MediaStore mediante plugin Android: permiso de fotos seleccionado, paginación, carpetas, miniaturas, favoritos y metadatos por dispositivo. El acceso se vuelve a comprobar al iniciar y al regresar a la app.
- Visor local con miniatura nativa, original en caché privado, reproducción de video desde archivo, conversión HEIC para vista previa y compartir con el selector Android. El borrado usa el diálogo de confirmación del sistema.
- Respaldo manual/a demanda hacia la cuenta TeleDrive, por carpeta, con hash para omitir duplicados y comprobación de cuenta/red por fragmento. La preferencia de respaldo automático revisa elementos nuevos cada 60 segundos con la app abierta y programa WorkManager (intervalo mínimo de 15 minutos). La transferencia depende del runtime de Telegram de la WebView; si Android termina el proceso o fuerza su detención, se retoma al abrir la app.

Para elementos locales se usa `DATE_TAKEN` de MediaStore y luego `DATE_MODIFIED`; todavía no se extrae EXIF directamente. Para elementos remotos se usa la fecha de captura guardada al respaldar o la fecha de subida.

## Referencia del Moto

Observación mediante REA el 30 de octubre de 2026:

- Motorola Edge 60 Pro, Android 17 / SDK 37, ARM64.
- Google Fotos `7.97.0.1000520730`, versionCode `52549343`.
- Pantalla Fotos: fondo oscuro, estado del respaldo arriba, carrusel de recuerdos, mosaico de imágenes y navegación flotante.
- Colecciones: tarjetas de accesos fijados, sección del dispositivo y álbumes.

Evidencias REA: versión `ev_04520a97ee2647a2dc5ad34be6994b441170e85c6684365926556e1cc4bd4f2b`; dispositivo `ev_6c09f8fe3555574a455ec37b283d518c6537029f29a4a5ecbe1458b4791f4d81`; Fotos `ev_f7429ee738cbb8b03a976ff3ced2cb1cfa2d47612ca171de157b28798cf279df`; Colecciones `ev_78fe13a6c3cad5fcec4d3d0f8a685ffa7af82f9088dced3d978386f165cc1665`.

No se incorporaron las fotos personales del teléfono al repositorio. Las referencias observadas guían el diseño; no implican paridad visual ni de comportamiento ya verificada.

## Validación

- `npm run build`: TypeScript y Vite pasan.
- `npm test`: 40 pruebas pasan, incluidas recuperación de conexiones de medios desconectadas, referencias vencidas y generación de portadas de video.
- Revisión visual en Chrome con datos sintéticos: galería, colecciones, búsqueda por álbum, selección y diálogo de álbumes. El archivo temporal de vista previa se retiró después de la comprobación.
- Build Android Tauri para ARM64 con JDK 21 y NDK 28.2: completado. Se corrigió `AR`/`RANLIB` para utilizar las herramientas del NDK al construir libsodium; se comprobó que el binario no tuviera símbolos `sodium_*` o `randombytes_*` sin resolver.
- APK instalada mediante ADB y actividad abierta en el Moto. Captura posterior al cambio confirma que aparece “Iniciar sesión” de Telegram (teléfono o QR) y no se solicita permiso de fotos antes de autenticar. El proceso permanece activo; logcat consultado sin `FATAL EXCEPTION` ni `UnsatisfiedLinkError`. No se concedió acceso a fotos.
- SHA-256 APK actual: `f5fb4aff65fcf9bd45c01728603d88ef1e00ba861a4b59b7012f36a0122fd89c`. Firmada con clave Android de depuración, no lista para distribución.
- La lectura de fotos seleccionadas en MediaStore queda sin validar porque el usuario prefirió no conceder el permiso. No se inició ninguna subida y no se borraron fotos.

## Compilar

Requiere Node, Rust con `aarch64-linux-android`, JDK 17/21 y Android SDK/NDK. Consultar [requisitos de Tauri](https://v2.tauri.app/start/prerequisites/) y [compilación Android](https://v2.tauri.app/distribute/google-play/).

```sh
npm ci
npm run build
npm test
npm run android:build -- --target aarch64 --apk
```

En este equipo, `scripts/android-wrapper.cjs` encuentra la toolchain Rust local bajo `.toolchains/` (ignorada por Git), además del SDK/NDK y JDK. En otro equipo configura `JAVA_HOME`, `ANDROID_HOME` y `NDK_HOME`. El proyecto firma la compilación de prueba con la clave de depuración; una publicación necesita una clave de distribución.

## Trabajo pendiente para el gemelo

- Transferencia completamente independiente del runtime de WebView cuando Android termina el proceso; WorkManager ya está integrado pero necesita ese runtime para transferir con GramJS.
- EXIF directo y recuerdos generados.
- Gestos de pinza/paneo completos, transiciones y revisión visual con una selección de fotos locales en el dispositivo.
- Edición, reconocimiento de personas/objetos, búsqueda semántica y administración completa de álbumes.
- Probar transferencias reales con Telegram y preparar firma de distribución cuando se solicite.

## Correcciones de biblioteca y navegación, 30 de octubre de 2026

- La biblioteca muestra exclusivamente el catálogo confirmado en Telegram. El dispositivo se consulta para seleccionar carpetas de respaldo.
- Foto de perfil de Telegram, botón flotante + multicolor, novedades en español y sin petición de estrella en GitHub.
- Se retiró la interfaz Drive de las rutas de la app; los enlaces antiguos a `/drive/*` regresan a `/photos`. Ajustes regresa a Fotos y utiliza el mismo respaldo de fotos/videos.
- El fallo de reproducción observado en el Moto se debía a un sender de medios desconectado mientras la conexión principal permanecía activa. Se descarta el sender cerrado y se reintenta la descarga obteniendo el mensaje de nuevo. Se observó reproducción con `readyState=4` y avance de tiempo después de la corrección.
- Se observaron cuatro miniaturas cargadas en la biblioteca después de reabrir la app.
- Atrás de Android vuelve del visor, ventanas, selección, filtros y ajustes. En la biblioteca principal pide dos pulsaciones dentro de dos segundos para enviar la app al fondo.

Las observaciones previas de permisos, hashes y pantallas de inicio en la sección de validación corresponden a compilaciones anteriores. La copia de prueba se actualiza sin borrar datos; no se subieron ni borraron archivos de la cuenta durante estas comprobaciones.

Validación final en Moto: APK SHA-256 `85c88add328b2659131d2e03ca55b924d4159c868eff6ca74ce10136eac4ea63`, instalada manteniendo datos. Se confirmó reproducción con avance, cuatro miniaturas cargadas al reabrir, FAB visible, ausencia del acceso a Drive, Atrás desde visor y ajustes hacia Fotos, primera pulsación en biblioteca sin salida y segunda pulsación enviando la app al launcher. Se volvió a abrir TeleFotos al finalizar.

Corrección de portadas negras: el 30 de octubre se detectó una miniatura de video válida como JPEG pero visualmente negra. Ahora se muestrean cuatro posiciones (12 %, 35 %, 55 %, 80 %), se espera el fotograma decodificado y se elige el de mayor visibilidad. Se versionó la caché de video para regenerar portadas antiguas. Validación en Moto: portada de video 144 × 256, brillo medio 117.48/255 y contenido visible, conservada después de terminar y reabrir el proceso; reproducción también comprobada. 41 pruebas pasan. APK instalada SHA-256 `bd3ebaacf0853bfc043e5026f528c7a68c077c1ffdbc9b4937a886f3dd94ac43`.

## Ajustes de interfaz, perfil, álbumes y descargas

- El perfil conserva un único acceso a Ajustes; se retiró la opción duplicada de respaldo. Consulta el usuario actual de Telegram, renueva la foto al abrir el perfil y conserva una caché por cuenta. La cuenta observada no devolvió foto de perfil, foto alternativa ni fotos de perfil disponibles; se usa su inicial.
- Cabecera con logo y nombre TeleFotos; tarjetas con títulos Favoritos y Videos y textos limitados al ancho de la tarjeta. Botón + circular junto a Buscar en la navegación inferior.
- Opciones de álbum: portada elegida entre sus elementos y eliminación de la agrupación conservando originales y pertenencia a otros álbumes. La portada se sincroniza en el catálogo de Telegram mediante `albumCoverFor`.
- Pulsación larga tolera movimientos pequeños; se verificaron dos selecciones consecutivas en el Moto sin abrir el visor. La barra de selección permite descargar varias fotos/videos. En Android se escriben originales en Pictures/TeleFotos o Movies/TeleFotos mediante MediaStore, por fragmentos y con IS_PENDING hasta completar; los errores eliminan la copia parcial.
- Visor con navegación por deslizamiento, sin flechas laterales; información arriba a la derecha y descarga en la barra inferior. Verificado un deslizamiento real en el Moto cambiando de imagen.
- 48 pruebas pasan, incluidas conservación de originales al eliminar álbumes, portada única y persistida, descarga por fragmentos exactos y limpieza al fallar. Se verificó escritura nativa temporal y su eliminación sin publicar un archivo de prueba en la galería.

APK final de estos ajustes instalada en el Moto sin borrar datos: SHA-256 `d4e8de9e236ed04000d545b23995695035cde8dd881402bb9898fc4cbd470bd1`. Revisión visual confirma logo visible dentro de la cabecera, textos de tarjetas dentro de sus límites, botón + circular junto a la lupa y seis miniaturas cargadas. El menú de cuenta tiene solo Ajustes, el álbum existente ofrece dos opciones de portada y confirmación de eliminación, y se canceló la confirmación sin modificar los álbumes del usuario. No se descargaron copias de sus archivos durante la comprobación nativa temporal.
