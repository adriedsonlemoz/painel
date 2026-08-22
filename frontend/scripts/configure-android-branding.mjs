import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const resDir = path.join(root, 'android', 'app', 'src', 'main', 'res')
const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml')
const stylesPath = path.join(resDir, 'values', 'styles.xml')
const sourceIcon = path.join(root, 'public', 'icons', 'al-sistemas-source.png')
const androidAssets = path.join(root, 'android-assets')
const appSurface = '#f0ede8'
const launcherSurface = '#12181c'

function ensureFile(file, label) {
  if (!fs.existsSync(file)) throw new Error(`${label} não encontrado: ${file}`)
}

function ensureDir(dir, label) {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new Error(`${label} não encontrado: ${dir}`)
}

function pngDimensions(file) {
  const data = fs.readFileSync(file)
  if (data.length < 24 || data.toString('ascii', 1, 4) !== 'PNG') throw new Error(`Asset não é PNG válido: ${file}`)
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) }
}

function ensureSquarePng(file, label) {
  ensureFile(file, label)
  const { width, height } = pngDimensions(file)
  if (width !== height) throw new Error(`${label} deve ser 1:1 para não ser deformado (${width}x${height}).`)
  return { width, height }
}

function copyDir(source, target) {
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name)
    const to = path.join(target, entry.name)
    if (entry.isDirectory()) copyDir(from, to)
    else fs.copyFileSync(from, to)
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function upsertStyleItem(xml, styleName, itemName, value) {
  const styleRe = new RegExp(`(<style\\b[^>]*name=["']${escapeRegExp(styleName)}["'][^>]*>)([\\s\\S]*?)(<\\/style>)`)
  const match = xml.match(styleRe)
  if (!match) throw new Error(`Style Android não encontrado: ${styleName}`)
  let body = match[2]
  const itemRe = new RegExp(`<item\\s+name=["']${escapeRegExp(itemName)}["'][^>]*>[\\s\\S]*?<\\/item>`, 'g')
  const item = `<item name="${itemName}">${value}</item>`
  if (itemRe.test(body)) body = body.replace(itemRe, item)
  else body = `${body.trimEnd()}\n        ${item}\n    `
  return xml.replace(styleRe, `${match[1]}${body}${match[3]}`)
}

ensureFile(manifestPath, 'AndroidManifest.xml')
ensureFile(stylesPath, 'styles.xml')
const approvedSize = ensureSquarePng(sourceIcon, 'Ícone aprovado')
ensureDir(androidAssets, 'Assets Android')

// Os assets Android são derivados do mesmo PNG aprovado e já vêm em proporção 1:1.
// O arquivo original fica preservado em public/icons/al-sistemas-source.png. O script
// apenas copia as derivações prontas para o projeto Capacitor recém-gerado; não recorta,
// estica ou recompõe a arte durante o build.
const resourceDirs = [
  'mipmap-mdpi', 'mipmap-hdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi',
  'drawable-mdpi', 'drawable-hdpi', 'drawable-xhdpi', 'drawable-xxhdpi', 'drawable-xxxhdpi',
]
for (const dir of resourceDirs) {
  const srcDir = path.join(androidAssets, dir)
  ensureDir(srcDir, `Assets ${dir}`)
  copyDir(srcDir, path.join(resDir, dir))
}

// Recursos do Adaptive Icon (Android 8+) e cores nativas.
const valuesDir = path.join(resDir, 'values')
const adaptiveDir = path.join(resDir, 'mipmap-anydpi-v26')
const drawableDir = path.join(resDir, 'drawable')
fs.mkdirSync(valuesDir, { recursive: true })
fs.mkdirSync(adaptiveDir, { recursive: true })
fs.mkdirSync(drawableDir, { recursive: true })

fs.writeFileSync(path.join(valuesDir, 'al_sistemas_branding.xml'), `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="al_sistemas_icon_background">${launcherSurface}</color>
    <color name="al_sistemas_splash_background">${appSurface}</color>
</resources>
`)

const adaptiveIconXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/al_sistemas_icon_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
`
fs.writeFileSync(path.join(adaptiveDir, 'ic_launcher.xml'), adaptiveIconXml)
fs.writeFileSync(path.join(adaptiveDir, 'ic_launcher_round.xml'), adaptiveIconXml)

// Splash pré-Android 12: bitmap centralizado em tamanho físico equivalente por densidade.
// Isso impede que a tela inteira estique o logo. No Android 12+, o sistema usa o novo
// Adaptive Icon do aplicativo na splash nativa.
fs.writeFileSync(path.join(drawableDir, 'al_sistemas_launch_background.xml'), `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/al_sistemas_splash_background" />
    <item>
        <bitmap
            android:src="@drawable/al_sistemas_splash_mark"
            android:gravity="center"
            android:filter="true" />
    </item>
</layer-list>
`)

let manifest = fs.readFileSync(manifestPath, 'utf8')
if (/android:icon="[^"]+"/.test(manifest)) {
  manifest = manifest.replace(/android:icon="[^"]+"/, 'android:icon="@mipmap/ic_launcher"')
} else {
  manifest = manifest.replace(/<application\b/, '<application android:icon="@mipmap/ic_launcher"')
}
if (/android:roundIcon="[^"]+"/.test(manifest)) {
  manifest = manifest.replace(/android:roundIcon="[^"]+"/, 'android:roundIcon="@mipmap/ic_launcher_round"')
} else {
  manifest = manifest.replace(/(<application\b[^>]*android:icon="@mipmap\/ic_launcher")/, '$1\n        android:roundIcon="@mipmap/ic_launcher_round"')
}
fs.writeFileSync(manifestPath, manifest)

let styles = fs.readFileSync(stylesPath, 'utf8')
for (const styleName of ['AppTheme', 'AppTheme.NoActionBar', 'AppTheme.NoActionBarLaunch']) {
  styles = upsertStyleItem(styles, styleName, 'android:statusBarColor', appSurface)
  styles = upsertStyleItem(styles, styleName, 'android:navigationBarColor', appSurface)
  styles = upsertStyleItem(styles, styleName, 'android:windowLightStatusBar', 'true')
  styles = upsertStyleItem(styles, styleName, 'android:windowLightNavigationBar', 'true')
}
for (const styleName of ['AppTheme', 'AppTheme.NoActionBar']) {
  styles = upsertStyleItem(styles, styleName, 'android:windowBackground', appSurface)
}
styles = upsertStyleItem(styles, 'AppTheme.NoActionBarLaunch', 'android:windowBackground', '@drawable/al_sistemas_launch_background')
styles = upsertStyleItem(styles, 'AppTheme.NoActionBarLaunch', 'android:background', '@drawable/al_sistemas_launch_background')
fs.writeFileSync(stylesPath, styles)

console.log(`✓ Ícone aprovado ${approvedSize.width}x${approvedSize.height} integrado integralmente, sem deformação`)
console.log('✓ Launcher Android: mipmaps por densidade + Adaptive Icon + roundIcon')
console.log('✓ Splash Android: marca centralizada, sem stretch, com fallback pré-Android 12')
console.log(`✓ Barras do Android alinhadas ao painel: ${appSurface}`)

// ── Gerenciador nativo de downloads ─────────────────────────────────────────
// Não depende de navegador externo. Usa android.app.DownloadManager, mantém a
// transferência em segundo plano e expõe progresso/status à WebView via Capacitor.
const javaRoot = path.join(root, 'android', 'app', 'src', 'main', 'java')
function findMainActivity(dir) {
  if (!fs.existsSync(dir)) return null
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) { const found = findMainActivity(full); if (found) return found }
    else if (entry.name === 'MainActivity.java') return full
  }
  return null
}
const mainActivityPath = findMainActivity(javaRoot)
if (!mainActivityPath) throw new Error('MainActivity.java não encontrado para registrar o gerenciador de downloads.')
let mainJava = fs.readFileSync(mainActivityPath, 'utf8')
const packageName = (mainJava.match(/package\s+([\w.]+)\s*;/) || [])[1]
if (!packageName) throw new Error('Package Java do Android não encontrado.')
const pluginPath = path.join(path.dirname(mainActivityPath), 'ALDownloadManagerPlugin.java')
const pluginJava = `package ${packageName};

import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

@CapacitorPlugin(name = "ALDownloadManager")
public class ALDownloadManagerPlugin extends Plugin {
  private Long readId(PluginCall call) {
    try {
      String raw = call.getString("id");
      if (raw != null && !raw.trim().isEmpty()) return Long.parseLong(raw.trim());
    } catch (Exception ignored) {}
    try {
      Long direct = call.getLong("id");
      if (direct != null) return direct;
    } catch (Exception ignored) {}
    try {
      if (call.getData().has("id")) return call.getData().getLong("id");
    } catch (Exception ignored) {}
    return null;
  }

  private DownloadManager manager() {
    return (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
  }

  private String reasonCode(int reason) {
    if (reason >= 400 && reason <= 599) return "HTTP_" + reason;
    if (reason == DownloadManager.ERROR_CANNOT_RESUME) return "CANNOT_RESUME";
    if (reason == DownloadManager.ERROR_DEVICE_NOT_FOUND) return "DEVICE_NOT_FOUND";
    if (reason == DownloadManager.ERROR_FILE_ALREADY_EXISTS) return "FILE_ALREADY_EXISTS";
    if (reason == DownloadManager.ERROR_FILE_ERROR) return "FILE_ERROR";
    if (reason == DownloadManager.ERROR_HTTP_DATA_ERROR) return "HTTP_DATA_ERROR";
    if (reason == DownloadManager.ERROR_INSUFFICIENT_SPACE) return "INSUFFICIENT_SPACE";
    if (reason == DownloadManager.ERROR_TOO_MANY_REDIRECTS) return "TOO_MANY_REDIRECTS";
    if (reason == DownloadManager.ERROR_UNHANDLED_HTTP_CODE) return "UNHANDLED_HTTP_CODE";
    if (reason == DownloadManager.ERROR_UNKNOWN) return "UNKNOWN";
    return "ANDROID_" + reason;
  }

  private String reasonMessage(int reason) {
    if (reason >= 400 && reason <= 599) return "O servidor recusou o download (HTTP " + reason + "). Abra o Log para ver o diagnóstico do artefato.";
    if (reason == DownloadManager.ERROR_CANNOT_RESUME) return "O Android não conseguiu retomar a transferência.";
    if (reason == DownloadManager.ERROR_DEVICE_NOT_FOUND) return "O destino de armazenamento não está disponível.";
    if (reason == DownloadManager.ERROR_FILE_ALREADY_EXISTS) return "Já existe um arquivo com esse nome no destino.";
    if (reason == DownloadManager.ERROR_FILE_ERROR) return "O Android encontrou um erro ao gravar o arquivo.";
    if (reason == DownloadManager.ERROR_HTTP_DATA_ERROR) return "A conexão HTTP foi interrompida durante a transferência.";
    if (reason == DownloadManager.ERROR_INSUFFICIENT_SPACE) return "Não há espaço de armazenamento suficiente para concluir o download.";
    if (reason == DownloadManager.ERROR_TOO_MANY_REDIRECTS) return "O servidor respondeu com redirecionamentos demais.";
    if (reason == DownloadManager.ERROR_UNHANDLED_HTTP_CODE) return "O servidor respondeu com um código HTTP que o DownloadManager não conseguiu tratar.";
    return "O Android não informou uma causa específica para a falha.";
  }

  @PluginMethod
  public void download(PluginCall call) {
    String url = call.getString("url");
    String filename = call.getString("filename", "download");
    String mime = call.getString("mime", "application/octet-stream");
    if (url == null || url.trim().isEmpty()) { call.reject("URL obrigatória."); return; }
    filename = filename.replaceAll("[^A-Za-z0-9._-]", "-");
    try {
      DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
      request.setTitle(filename);
      request.setDescription("AL Sistemas · baixando arquivo");
      request.setMimeType(mime);
      request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
      request.setAllowedOverMetered(true);
      request.setAllowedOverRoaming(true);
      request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "AL-Sistemas/" + filename);
      long id = manager().enqueue(request);
      JSObject ret = new JSObject();
      // String evita conversões inconsistentes de Long entre Java e JavaScript.
      ret.put("id", String.valueOf(id));
      ret.put("filename", filename);
      ret.put("status", "pending");
      call.resolve(ret);
    } catch (Exception e) { call.reject("Não foi possível iniciar o download: " + e.getMessage(), e); }
  }

  @PluginMethod
  public void getStatus(PluginCall call) {
    Long id = readId(call);
    if (id == null || id <= 0) { call.reject("Identificador do download inválido."); return; }
    DownloadManager.Query query = new DownloadManager.Query().setFilterById(id);
    try (Cursor c = manager().query(query)) {
      if (c == null || !c.moveToFirst()) {
        JSObject ret = new JSObject(); ret.put("id", String.valueOf(id)); ret.put("status", "cancelled"); ret.put("progress", 0); call.resolve(ret); return;
      }
      int status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
      long downloaded = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
      long total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
      int reason = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
      String mediaType = c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_MEDIA_TYPE));
      String title = c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TITLE));
      long lastModified = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_LAST_MODIFIED_TIMESTAMP));
      Uri contentUri = manager().getUriForDownloadedFile(id);
      String label = "pending";
      if (status == DownloadManager.STATUS_RUNNING) label = "running";
      else if (status == DownloadManager.STATUS_PAUSED) label = "paused";
      else if (status == DownloadManager.STATUS_SUCCESSFUL) label = "successful";
      else if (status == DownloadManager.STATUS_FAILED) label = "failed";
      int progress = total > 0 ? (int)Math.min(100, Math.round(downloaded * 100.0 / total)) : (status == DownloadManager.STATUS_SUCCESSFUL ? 100 : 0);
      JSObject ret = new JSObject();
      ret.put("id", String.valueOf(id)); ret.put("status", label); ret.put("progress", progress);
      ret.put("downloaded", downloaded); ret.put("total", total); ret.put("reason", reason);
      if (status == DownloadManager.STATUS_FAILED) {
        ret.put("reasonCode", reasonCode(reason)); ret.put("reasonMessage", reasonMessage(reason));
        if (reason >= 400 && reason <= 599) ret.put("httpStatus", reason);
      }
      ret.put("mime", mediaType == null ? "" : mediaType); ret.put("title", title == null ? "" : title);
      ret.put("lastModified", lastModified);
      ret.put("uri", contentUri == null ? "" : contentUri.toString());
      ret.put("canOpen", status == DownloadManager.STATUS_SUCCESSFUL && contentUri != null);
      if (status == DownloadManager.STATUS_FAILED) ret.put("message", reasonMessage(reason));
      call.resolve(ret);
    } catch (Exception e) { call.reject("Falha ao consultar download: " + e.getMessage(), e); }
  }

  @PluginMethod
  public void cancel(PluginCall call) {
    Long id = readId(call);
    if (id == null || id <= 0) { call.reject("Identificador do download inválido."); return; }
    try { int removed = manager().remove(id); JSObject ret = new JSObject(); ret.put("ok", removed > 0); ret.put("id", String.valueOf(id)); call.resolve(ret); }
    catch (Exception e) { call.reject("Não foi possível cancelar o download: " + e.getMessage(), e); }
  }

  @PluginMethod
  public void open(PluginCall call) {
    Long id = readId(call);
    if (id == null || id <= 0) { call.reject("Identificador do download inválido."); return; }
    try {
      Uri uri = manager().getUriForDownloadedFile(id);
      if (uri == null) { call.reject("Arquivo concluído não encontrado."); return; }
      DownloadManager.Query q = new DownloadManager.Query().setFilterById(id);
      String mime = "application/octet-stream";
      String title = "";
      int status = DownloadManager.STATUS_PENDING;
      try (Cursor c = manager().query(q)) {
        if (c != null && c.moveToFirst()) {
          status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
          String found = c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_MEDIA_TYPE));
          if (found != null && !found.isEmpty()) mime = found;
          String foundTitle = c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TITLE));
          if (foundTitle != null) title = foundTitle;
        }
      }
      if (status != DownloadManager.STATUS_SUCCESSFUL) { call.reject("O arquivo ainda não terminou de baixar."); return; }
      boolean isApk = "application/vnd.android.package-archive".equalsIgnoreCase(mime) || title.toLowerCase().endsWith(".apk");
      if (isApk) mime = "application/vnd.android.package-archive";

      if (isApk && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
        Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
        settings.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(settings);
        JSObject ret = new JSObject();
        ret.put("ok", false); ret.put("id", String.valueOf(id)); ret.put("needsInstallPermission", true);
        ret.put("message", "Autorize o AL Sistemas a instalar apps desconhecidos e depois toque em Abrir novamente.");
        call.resolve(ret); return;
      }

      Intent intent = new Intent(Intent.ACTION_VIEW);
      intent.setDataAndType(uri, mime);
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
      PackageManager pm = getContext().getPackageManager();
      if (intent.resolveActivity(pm) == null) {
        call.reject(isApk ? "O instalador de pacotes do Android não está disponível." : "Nenhum aplicativo instalado consegue abrir este tipo de arquivo.");
        return;
      }
      getContext().startActivity(intent);
      JSObject ret = new JSObject();
      ret.put("ok", true); ret.put("id", String.valueOf(id)); ret.put("uri", uri.toString()); ret.put("mime", mime);
      call.resolve(ret);
    } catch (ActivityNotFoundException e) {
      call.reject("Nenhum aplicativo compatível foi encontrado para abrir o arquivo.", e);
    } catch (Exception e) { call.reject("Não foi possível abrir o arquivo: " + e.getMessage(), e); }
  }
}
`
fs.writeFileSync(pluginPath, pluginJava)
if (!mainJava.includes('registerPlugin(ALDownloadManagerPlugin.class)')) {
  if (/\b(?:public|protected)\s+void\s+onCreate\s*\(/.test(mainJava)) {
    mainJava = mainJava.replace(/((?:public|protected)\s+void\s+onCreate\([^)]*\)\s*\{)/, '$1\n        registerPlugin(ALDownloadManagerPlugin.class);')
  } else {
    const lastBrace = mainJava.lastIndexOf('}')
    if (lastBrace < 0) throw new Error('Estrutura de MainActivity.java inválida.')
    const method = `\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n        registerPlugin(ALDownloadManagerPlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n`
    mainJava = mainJava.slice(0, lastBrace) + method + mainJava.slice(lastBrace)
  }
  fs.writeFileSync(mainActivityPath, mainJava)
}

// Android 9 e anteriores ainda podem exigir permissão ao gravar em Downloads.
manifest = fs.readFileSync(manifestPath, 'utf8')
if (!manifest.includes('android.permission.WRITE_EXTERNAL_STORAGE')) {
  manifest = manifest.replace(/<manifest([^>]*)>/, '<manifest$1>\n    <uses-permission android:name="android.permission.WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="28" />')
}
if (!manifest.includes('android.permission.REQUEST_INSTALL_PACKAGES')) {
  manifest = manifest.replace(/<manifest([^>]*)>/, '<manifest$1>\n    <uses-permission android:name="android.permission.REQUEST_INSTALL_PACKAGES" />')
}
fs.writeFileSync(manifestPath, manifest)
console.log('✓ Gerenciador Android integrado: Downloads/AL-Sistemas + progresso nativo + abertura segura de APK')

// ── Sessão nativa protegida ────────────────────────────────────────────────
// Guarda apenas o token de sessão persistente do APK usando Android Keystore
// + AES/GCM. A senha administrativa nunca é armazenada.
const secureSessionPluginPath = path.join(path.dirname(mainActivityPath), 'ALSecureSessionPlugin.java')
const secureSessionJava = `package ${packageName};

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "ALSecureSession")
public class ALSecureSessionPlugin extends Plugin {
  private static final String PREFS = "al_secure_session";
  private static final String ALIAS = "al_sistemas_session_key";
  private static final String TOKEN = "token";
  private static final String IV = "iv";

  private SharedPreferences prefs() {
    return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  private SecretKey getOrCreateKey() throws Exception {
    KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
    ks.load(null);
    if (ks.containsAlias(ALIAS)) return ((KeyStore.SecretKeyEntry) ks.getEntry(ALIAS, null)).getSecretKey();
    KeyGenerator kg = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
    kg.init(new KeyGenParameterSpec.Builder(ALIAS,
      KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setRandomizedEncryptionRequired(true)
      .build());
    return kg.generateKey();
  }

  @PluginMethod
  public void set(PluginCall call) {
    String value = call.getString("value");
    if (value == null || value.isEmpty()) { remove(call); return; }
    try {
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
      byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
      prefs().edit()
        .putString(TOKEN, Base64.encodeToString(encrypted, Base64.NO_WRAP))
        .putString(IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
        .apply();
      JSObject ret = new JSObject(); ret.put("ok", true); call.resolve(ret);
    } catch (Exception e) { call.reject("Não foi possível proteger a sessão: " + e.getMessage(), e); }
  }

  @PluginMethod
  public void get(PluginCall call) {
    try {
      String enc = prefs().getString(TOKEN, "");
      String iv = prefs().getString(IV, "");
      JSObject ret = new JSObject();
      if (enc.isEmpty() || iv.isEmpty()) { ret.put("value", ""); call.resolve(ret); return; }
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
      String value = new String(cipher.doFinal(Base64.decode(enc, Base64.NO_WRAP)), StandardCharsets.UTF_8);
      ret.put("value", value); call.resolve(ret);
    } catch (Exception e) {
      prefs().edit().clear().apply();
      JSObject ret = new JSObject(); ret.put("value", ""); call.resolve(ret);
    }
  }

  @PluginMethod
  public void remove(PluginCall call) {
    prefs().edit().clear().apply();
    JSObject ret = new JSObject(); ret.put("ok", true); call.resolve(ret);
  }
}
`
fs.writeFileSync(secureSessionPluginPath, secureSessionJava)
if (!mainJava.includes('registerPlugin(ALSecureSessionPlugin.class)')) {
  mainJava = fs.readFileSync(mainActivityPath, 'utf8')
  mainJava = mainJava.replace('registerPlugin(ALDownloadManagerPlugin.class);', 'registerPlugin(ALDownloadManagerPlugin.class);\n        registerPlugin(ALSecureSessionPlugin.class);')
  fs.writeFileSync(mainActivityPath, mainJava)
}
console.log('✓ Sessão persistente do APK protegida pelo Android Keystore')
