import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const resDir = path.join(root, 'android', 'app', 'src', 'main', 'res')
const manifestPath = path.join(root, 'android', 'app', 'src', 'main', 'AndroidManifest.xml')
const stylesPath = path.join(resDir, 'values', 'styles.xml')
const sourceIcon = path.join(root, 'public', 'icons', 'al-sistemas-source.png')
const drawableDir = path.join(resDir, 'drawable-nodpi')
const targetIcon = path.join(drawableDir, 'al_sistemas_icon.png')
const appSurface = '#f0ede8'

function ensureFile(file, label) {
  if (!fs.existsSync(file)) throw new Error(`${label} não encontrado: ${file}`)
}

ensureFile(manifestPath, 'AndroidManifest.xml')
ensureFile(stylesPath, 'styles.xml')
ensureFile(sourceIcon, 'Ícone aprovado')

fs.mkdirSync(drawableDir, { recursive: true })
fs.copyFileSync(sourceIcon, targetIcon)

let manifest = fs.readFileSync(manifestPath, 'utf8')
manifest = manifest.replace(/android:icon="[^"]+"/, 'android:icon="@drawable/al_sistemas_icon"')
if (/android:roundIcon="[^"]+"/.test(manifest)) {
  manifest = manifest.replace(/android:roundIcon="[^"]+"/, 'android:roundIcon="@drawable/al_sistemas_icon"')
} else {
  manifest = manifest.replace(/(<application\b[^>]*android:icon="@drawable\/al_sistemas_icon")/, '$1\n        android:roundIcon="@drawable/al_sistemas_icon"')
}
fs.writeFileSync(manifestPath, manifest)

let styles = fs.readFileSync(stylesPath, 'utf8')
const items = [
  ['android:statusBarColor', appSurface],
  ['android:navigationBarColor', appSurface],
  ['android:windowLightStatusBar', 'true'],
  ['android:windowLightNavigationBar', 'true'],
  ['android:windowBackground', appSurface],
]

styles = styles.replace(/<style\b([^>]*)>([\s\S]*?)<\/style>/g, (full, attrs, body) => {
  let next = body
  for (const [name, value] of items) {
    const re = new RegExp(`<item\\s+name=["']${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>[\\s\\S]*?<\\/item>`, 'g')
    const item = `\n        <item name="${name}">${value}</item>`
    if (re.test(next)) next = next.replace(re, item.trimStart())
    else next += item
  }
  return `<style${attrs}>${next}\n    </style>`
})
fs.writeFileSync(stylesPath, styles)

console.log(`✓ Ícone AL Sistemas aplicado: ${path.relative(root, targetIcon)}`)
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
import android.content.Context;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;

@CapacitorPlugin(name = "ALDownloadManager")
public class ALDownloadManagerPlugin extends Plugin {
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
      DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
      long id = manager.enqueue(request);
      JSObject ret = new JSObject(); ret.put("id", id); ret.put("filename", filename); call.resolve(ret);
    } catch (Exception e) { call.reject("Não foi possível iniciar o download: " + e.getMessage(), e); }
  }

  @PluginMethod
  public void getStatus(PluginCall call) {
    Long id = call.getLong("id");
    if (id == null) { call.reject("ID do download obrigatório."); return; }
    DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
    DownloadManager.Query query = new DownloadManager.Query().setFilterById(id);
    try (Cursor c = manager.query(query)) {
      if (c == null || !c.moveToFirst()) { call.reject("Download não encontrado."); return; }
      int status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
      long downloaded = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
      long total = c.getLong(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
      int reason = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
      String uri = c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI));
      String label = "pending";
      if (status == DownloadManager.STATUS_RUNNING) label = "running";
      else if (status == DownloadManager.STATUS_PAUSED) label = "paused";
      else if (status == DownloadManager.STATUS_SUCCESSFUL) label = "successful";
      else if (status == DownloadManager.STATUS_FAILED) label = "failed";
      int progress = total > 0 ? (int)Math.min(100, Math.round(downloaded * 100.0 / total)) : (status == DownloadManager.STATUS_SUCCESSFUL ? 100 : 0);
      JSObject ret = new JSObject();
      ret.put("id", id); ret.put("status", label); ret.put("progress", progress);
      ret.put("downloaded", downloaded); ret.put("total", total); ret.put("reason", reason); ret.put("uri", uri == null ? "" : uri);
      if (status == DownloadManager.STATUS_FAILED) ret.put("message", "Download falhou no Android (código " + reason + ").");
      call.resolve(ret);
    } catch (Exception e) { call.reject("Falha ao consultar download: " + e.getMessage(), e); }
  }
}
`
fs.writeFileSync(pluginPath, pluginJava)
if (!mainJava.includes('registerPlugin(ALDownloadManagerPlugin.class)')) {
  if (mainJava.includes('protected void onCreate')) {
    mainJava = mainJava.replace(/(protected void onCreate\([^)]*\)\s*\{)/, '$1\n        registerPlugin(ALDownloadManagerPlugin.class);')
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
  fs.writeFileSync(manifestPath, manifest)
}
console.log('✓ Gerenciador Android integrado: Downloads/AL-Sistemas + progresso nativo')
