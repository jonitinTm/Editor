# Cómo publicar Photocap (web y Google Play)

Esta guía resume los pasos que quedan para publicar. Lo técnico ya está preparado en el proyecto: manifiesto de
aplicación, iconos (también el adaptable de Android), funcionamiento sin conexión, política de privacidad
(`privacidad.html`) e imágenes para la ficha de la tienda (`docs/play-store/`).

> Las normas de Google Play cambian a menudo. Comprueba cada paso en la ayuda oficial de Play Console antes de hacerlo.

## Lo que tienes que decidir tú

1. **Correo de contacto.** Sustituye `[CORREO DE CONTACTO]` en `public/privacidad.html`. Google Play exige un
   correo de contacto en la ficha.
2. **Licencia.** Si vas a vender la app o una suscripción, lo normal es no publicar el código con una licencia
   libre. Al menos añade un archivo `LICENSE` con «Todos los derechos reservados». Si el repositorio de GitHub es
   público, cualquiera puede ver el código; puedes hacerlo privado (GitHub Pages en repositorios privados requiere
   un plan de pago de GitHub).
3. **Nombre.** Elegido: **Photocap** (en la ficha de Google Play se puede titular «Photocap – Editor de fotos»).
   Antes de publicar, comprobar que no hay otra app o marca registrada con ese nombre o uno muy parecido
   (buscar en Google Play y en el registro de marcas de la EUIPO); se cree que existió un programa de Windows
   llamado «PhotoCap», pero no se ha podido confirmar.
4. **Dominio.** Ver el apartado siguiente.

## 1. La web

La versión web se publica con GitHub Pages desde la rama principal (`main`). La web ya pasa la comprobación de Chrome
de «aplicación instalable» (manifiesto, iconos y service worker).

Para publicar:

1. Fusiona esta rama de trabajo en `main`.
2. En GitHub: *Settings › Pages › Build and deployment › Deploy from a branch › `main` / (root)*.
3. La dirección será `https://<usuario>.github.io/Editor/`.

### Dominio propio (recomendado para la Play Store)

Para que la app de Android abra la web a pantalla completa, sin barra del navegador, Google comprueba un archivo
`/.well-known/assetlinks.json` en la **raíz del dominio**. En `https://<usuario>.github.io/Editor/` ese archivo
tendría que estar en `https://<usuario>.github.io/.well-known/`, que pertenece a otro repositorio.

Hay dos soluciones:

- **Un dominio propio** (unos 10–15 € al año), configurado en *Settings › Pages › Custom domain*. Es lo más
  sencillo y además da una dirección con tu marca.
- Publicar la web en un repositorio llamado `<usuario>.github.io`, de modo que la app quede en la raíz.

## 2. Google Play (app de Android a partir de la web)

La forma más directa es una **Trusted Web Activity (TWA)**: una app de Android que muestra la web a pantalla completa.
Las actualizaciones de la web llegan solas, sin subir una versión nueva a la tienda.

1. **Cuenta de desarrollador** en Google Play Console. Tiene un pago único y exige verificar tu identidad.
   - Las cuentas personales nuevas tienen que hacer una **prueba cerrada** antes de publicar para todo el mundo. Según
     las normas actuales, son al menos 12 personas durante 14 días.
2. **Generar la app.** En [PWABuilder](https://www.pwabuilder.com), pon la dirección de la web, elige *Android* y
   descarga el paquete.
   - Usa como *package id* algo como `com.tunombre.editor`.
   - Guarda **muy bien** la clave de firma que genera: sin ella no podrás actualizar la app nunca.
   - Alternativa por línea de comandos: Bubblewrap (`npx @bubblewrap/cli init --manifest https://…/manifest.webmanifest`).
3. **Vincular web y app.** PWABuilder te da un `assetlinks.json`. Súbelo a `/.well-known/assetlinks.json` en la raíz
   de tu dominio.
   - Si usas Play App Signing, añade también la huella SHA-256 que aparece en Play Console (*Integridad de la app*).
4. **Subir el `.aab`** a Play Console y rellenar la ficha:
   - Icono 512×512: `public/icon-512.png`.
   - Gráfico destacado 1024×500: `docs/play-store/grafico-destacado.png`.
   - Capturas de móvil y de tableta: `docs/play-store/`.
   - URL de la política de privacidad: `https://<tu-dominio>/privacidad.html`.
5. **Formulario «Seguridad de los datos».** Con la app tal como está, la respuesta es que **no recoge ni comparte
   datos**: las imágenes no salen del dispositivo y no hay cuentas, publicidad ni analíticas. Las descargas de
   tipografías y modelos de IA no envían datos del usuario.
6. **Clasificación de contenido** (cuestionario) y **público objetivo**.

## 3. Cuando llegue el cobro (suscripción, pago único o anuncios)

- **Dentro de la app de Google Play**, los pagos de funciones digitales tienen que hacerse con la **facturación de
  Google Play**, que se queda con una comisión. En la web puedes usar otro sistema de pago (por ejemplo, Stripe).
- **Cuentas.** Una suscripción necesita saber quién ha pagado, así que hará falta un sistema de cuentas y un pequeño
  servidor. Las imágenes pueden seguir sin salir del dispositivo.
- **Anuncios.** Obligan a pedir consentimiento en Europa (RGPD) y a actualizar la política de privacidad y el
  formulario de seguridad de los datos.
- En cualquiera de estos casos, **actualiza `privacidad.html` antes** de activarlo.
