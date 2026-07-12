# Red Team Raporu — Specfold

**Tarih:** 2026-07-10
**Kapsam:** Ürün konsepti + mevcut kod tabanı (`apps/desktop`, `packages/core`), v0.1.0
**Yöntem:** Kaynak kod incelemesi (statik), tehdit modelleme, ürün varsayımlarının sorgulanması. Dinamik test / fuzzing yapılmadı.

---

## Yönetici Özeti

Uygulamanın tek cümlelik değeri "OpenAPI import et → düzenle → seçili klasörü **temiz** OpenAPI olarak müşteriye gönder". Red team bakışıyla en kritik bulgular tam da bu değer vaadini vuruyor:

1. **Export edilen dosya sır sızdırabiliyor** (header/query değerleri `example` olarak gömülüyor, tek klasör seçilse bile tüm `components` pakete giriyor) — ve bu dosya tanım gereği **müşteriye mail atılıyor**.
2. **Veri kaybı zinciri:** bozuk/okunamayan `workspace.json` sessizce boş workspace'e dönüşüyor ve 350 ms sonra otomatik kayıt eski dosyanın **üzerine yazıyor**. Tüm koleksiyonlar tek hatayla geri dönüşsüz silinebilir.
3. **Sırlar düz metin saklanıyor;** "secret" işareti yalnızca UI maskesi.
4. **Round-trip kayıplı:** import edilen dokümanın parametre şemaları, response şemaları ve OAuth2 güvenlik tanımları export'ta kayboluyor veya uyduruluyor — "temiz OpenAPI paketi" vaadi bugünkü haliyle tutmuyor.

---

## Tehdit Modeli (özet)

| Aktör / Senaryo | İlgi alanı |
|---|---|
| Müşteriye giden export dosyasını alan üçüncü taraf | Dosyaya gömülü sırlar, iç şemalar, iç endpoint bilgisi |
| Aynı makinedeki kötücül yazılım / başka kullanıcı | `%APPDATA%`'daki düz metin token/parola |
| Yapıştırılan kötücül OpenAPI/YAML dokümanı | Parser DoS, prototype pollution, UI kilitlenmesi |
| Kullanıcının kendisi (kaza) | Onaysız silme, sessiz veri kaybı, çakışan instance'lar |
| Hedeflenen istek atılan sunucu | Yanıt tabanlı DoS (sonsuz/dev gövde), redirect |

Not: Bu bir REST client olduğundan "keyfi URL'ye istek atma" (SSRF benzeri) davranış üründür, bulgu değildir.

---

## Bulgular

### KRİTİK

#### K-1 — Bozuk workspace dosyası → sessiz tam veri kaybı
`loadWorkspace` her hatada (bozuk JSON, kilitli dosya, izin hatası) **sessizce boş workspace** döndürüyor ([main/index.ts:31-42](../apps/desktop/src/main/index.ts:31)). Renderer yüklenir yüklenmez autosave devreye giriyor ([App.tsx:98-111](../apps/desktop/src/renderer/App.tsx:98)) ve boş workspace'i eski dosyanın üzerine yazıyor. `writeFile` atomik olmadığı için ([main/index.ts:47](../apps/desktop/src/main/index.ts:47)) yazma sırasında çökme → bozuk JSON → bir sonraki açılışta boş workspace → kalan her şeyin silinmesi. `schemaVersion !== 1` durumu da aynı sessiz silme yolunu izliyor.

**Senaryo:** Elektrik kesintisi anında kayıt yapılıyordu → kullanıcı ertesi gün uygulamayı açıyor → tüm koleksiyonlar yok ve dosya artık boş workspace ile üzerine yazılmış; kurtarma imkânı yok.

**Öneri:** (a) temp dosyaya yaz + rename (atomik), (b) yüklenemeyen dosyayı `workspace.json.corrupt-<ts>` olarak kenara al ve kullanıcıya söyle, asla üzerine yazma, (c) rotasyonlu yedek (son N kayıt), (d) bilinmeyen `schemaVersion` için "salt-okunur aç / yedek al" akışı.

#### K-2 — Export dosyasına sır ve iç bilgi sızması (ana kullanım senaryosunu vuruyor)
- Header/query/path parametre **değerleri** olduğu gibi `example` alanına yazılıyor ([exportOpenApi.ts:197-206](../packages/core/src/exporters/openapi/exportOpenApi.ts:197)). Kullanıcı denemek için gerçek bir `X-API-Key` veya token yazdıysa, bu değer müşteriye giden YAML'a gömülür. `Authorization` ve `Content-Type` atlanıyor ama başka hiçbir header korunmuyor.
- Body `raw` içeriği `example` olarak export ediliyor ([exportOpenApi.ts:220-222](../packages/core/src/exporters/openapi/exportOpenApi.ts:220)); gerçek kimlik bilgisiyle test edilmiş bir body aynen paketlenir.
- `includeAllComponents` (UI'da varsayılan **açık**, [App.tsx:81](../apps/desktop/src/renderer/App.tsx:81)) tek klasör export edilse bile **tüm API'nin** şemalarını ve `securitySchemes`'ini dosyaya koyuyor ([exportOpenApi.ts:120-136](../packages/core/src/exporters/openapi/exportOpenApi.ts:120)). Müşteriye "sadece şu 5 endpoint" gönderdiğinizi sanırken iç endpoint'lerin veri modellerini de göndermiş olursunuz. "Remove unused components" seçeneği UI'da var ama devre dışı/işlevsiz ([App.tsx:1323-1326](../apps/desktop/src/renderer/App.tsx:1323)).

**Öneri:** Export öncesi zorunlu bir "sızıntı taraması" adımı: (a) `{{var}}` kalıbı dışındaki dolu param/header değerlerini ve JWT/uzun-rastgele-string desenlerini işaretle, (b) kullanılmayan component'leri buda (ref-graph takibi) ve bunu varsayılan yap, (c) `example` yazmayı opt-in yap, (d) export önizlemesinde "bu dosyada şu değişmez değerler var" uyarı listesi göster.

#### K-3 — Sırlar düz metin, "secret" bayrağı kozmetik
Token/parola dahil tüm environment değişkenleri `%APPDATA%/.../workspace.json` içinde düz metin. `secret: true` yalnızca input'u `type="password"` yapıyor ([App.tsx:1217-1221](../apps/desktop/src/renderer/App.tsx:1217)); saklamaya, loglamaya, export'a etkisi yok. Roadmap'te OS vault "Next" olarak duruyor ama portable exe (USB'de taşınan senaryo) bugün dağıtılıyor.

**Öneri:** MVP için bile asgari: secret değişkenleri `safeStorage` (DPAPI) ile şifrele; Collection JSON export'una environment/secret dahil edilmediğini garanti eden test yaz; README'ye mevcut sınırlamayı açıkça yaz.

---

### YÜKSEK

#### Y-1 — Aynı path+method sessizce eziliyor → müşteri paketinde istek kaybı
Export'ta `pathItem[method] = {...}` doğrudan atama ([exportOpenApi.ts:58-70](../packages/core/src/exporters/openapi/exportOpenApi.ts:58)). Kullanıcı manuel eklemelerle aynı `POST /auth/token`'ın iki varyantını oluşturduysa (ürünün teşvik ettiği bir akış — JWT şablonu tam da böyle istekler üretir), export **sessizce birini atar**. Müşteri eksik doküman alır, kimse fark etmez.

**Öneri:** Export sırasında çakışmaları tespit et; kullanıcıya "şu 2 istek aynı path+method'a düşüyor" uyarısı + hangisinin kazanacağını seçtir.

#### Y-2 — Round-trip fidelity: "temiz OpenAPI" vaadi tutmuyor
Import → hiç dokunmadan export senaryosunda kayıplar:
- Parametre şemaları atılıp string örnek değerden `inferPrimitiveType` ile **yeniden uyduruluyor** ([exportOpenApi.ts:324-332](../packages/core/src/exporters/openapi/exportOpenApi.ts:324)): enum, format, pattern, required (query'de her zaman `false`) kaybolur; `"123"` değerli bir string ID parametresi `type: number` olur — müşteri codegen çalıştırırsa yanlış tip üretir.
- Response **şemaları** tamamen düşüyor; yalnızca example kalıyor, example kapalıysa her şey jenerik `200` oluyor ([exportOpenApi.ts:232-258](../packages/core/src/exporters/openapi/exportOpenApi.ts:232)).
- OAuth2/OIDC security scheme'leri import'ta `type: "none"`a düşüyor ([shared.ts:262-292](../packages/core/src/importers/shared.ts:262)) → export'ta güvenlik tanımı yok.
- Kaynak 3.1 olsa da çıktı `openapi: "3.0.3"` damgalanıyor ([exportOpenApi.ts:73](../packages/core/src/exporters/openapi/exportOpenApi.ts:73)); 3.1-özgü şemalar (type dizileri, `null` tipi) geçersiz 3.0 üretir.
- Server fallback'i `{ url: "{{baseUrl}}" }` ([exportOpenApi.ts:143](../packages/core/src/exporters/openapi/exportOpenApi.ts:143)) — OpenAPI server templating `{var}` biçimidir; `{{baseUrl}}` **geçersiz doküman** üretir, müşterinin validator'ı/Swagger UI'ı reddeder. Aynı şekilde path param değeri boşsa export'a `example: "{{userId}}"` gibi iç değişken sözdizimi sızar.
- `{{baseUrl}}` dışındaki bir değişkenle başlayan manuel istek URL'si (`{{host}}/x`) path anahtarına olduğu gibi giriyor ([exportOpenApi.ts:146-164](../packages/core/src/exporters/openapi/exportOpenApi.ts:146)) → `paths: { "{{host}}/x": ... }`.

**Öneri:** (a) Import'ta `rawOperation` zaten saklanıyor ([importOpenApi.ts:165](../packages/core/src/importers/openapi/importOpenApi.ts:165)) — kullanıcı dokunmadıysa export'ta uydurmak yerine bunu temel al, yalnızca değişen alanları üstüne yaz; (b) export çıktısını CI'da gerçek bir OpenAPI validator'dan geçiren golden-file testleri ekle (mevcut 2 test dosyası bu yüzeyi karşılamıyor); (c) `{{var}}` → `{var}` dönüşümü veya export öncesi değişken çözümleme seçeneği.

#### Y-3 — HTTP motoru: timeout, iptal, boyut sınırı, kurumsal TLS yok
`sendHttpRequest` ([main/index.ts:54-105](../apps/desktop/src/main/index.ts:54)):
- **Timeout/AbortController yok** — asılan sunucu = sonsuz "Sending", iptal butonu yok.
- `response.arrayBuffer()` sınırsız — kötücül/yanlış endpoint'in verdiği dev veya sonsuz stream gövde main process'i OOM'a götürür; ardından dev string `<pre>` içinde renderer'ı kilitler.
- Redirect'ler koşulsuz takip ediliyor; `Authorization` header'ının cross-origin redirect'te ne olacağı tanımsız (undici davranışına emanet).
- **Self-signed / iç CA desteği yok, proxy desteği yok.** Hedef kullanıcı "Apinizer/API gateway ile çalışan kurumsal geliştirici" — bu ortamların çoğu iç CA'lı TLS ve kurumsal proxy arkasında. Node fetch iç CA'yı reddeder → ürün hedef kitlesi için **ilk gün çalışmayabilir**.
- Binary yanıtlar `TextDecoder` ile bozularak gösteriliyor.

**Öneri:** AbortController + kullanıcı ayarlı timeout + iptal butonu; yanıt boyutu üst sınırı (ör. 10 MB, sonrası "dosyaya kaydet"); "TLS doğrulamasını bu istek için atla" opsiyonu (belirgin uyarıyla) ve sistem proxy desteği.

#### Y-4 — Onaysız yıkıcı işlemler
- "New workspace" tek tıkla mevcut her şeyi bellekte siliyor ve autosave ile kalıcılaştırıyor ([App.tsx:170-180](../apps/desktop/src/renderer/App.tsx:170)); onay yok, geri alma yok.
- Environment silme de onaysız ([App.tsx:1159-1161](../apps/desktop/src/renderer/App.tsx:1159)).
- Uygulamanın hiçbir yerinde undo yok; tek yanlış tık + 350 ms = kalıcı.

**Öneri:** Yıkıcı işlemlere onay diyaloğu; K-1'deki yedek rotasyonu buradaki hataları da telafi eder.

#### Y-5 — Platform/dağıtım sertleştirmesi
- Electron **31.7.7**: destek penceresi kapanmış bir sürüm; bilinen Chromium CVE'leriyle dağıtım yapılıyor.
- `sandbox: false` ([main/index.ts:130](../apps/desktop/src/main/index.ts:130)) — contextIsolation açık olsa da renderer sandbox'ı kapalı; savunma katmanı eksik. Renderer'da CSP de yok.
- İmzasız exe (`signAndEditExecutable: false`): SmartScreen uyarısı + kullanıcıları "uyarıyı geçme"ye alıştırma + tamper tespiti yok. Portable Electron exe'leri AV false-positive mıknatısıdır.
- İki instance aynı anda çalışırsa (`requestSingleInstanceLock` yok) `workspace.json` last-writer-wins ile ezilir.

**Öneri:** Electron'u destekli sürüme yükselt; `sandbox: true`; `requestSingleInstanceLock`; imzalama roadmap'te zaten var — açık kaynak yayın öncesine çek.

---

### ORTA

#### O-1 — "Kalp" akış yarım: token yanıtını değişkene aktarma yok
JWT şablonu istek üretiyor ([factory.ts:65-104](../packages/core/src/model/factory.ts:65)) ama yanıttaki `access_token`'ı `{{accessToken}}`'a taşıyan hiçbir mekanizma yok. Script engine bilinçli olarak kapsam dışı — doğru karar — ama sonuç: kullanıcı her token yenilemede yanıttan elle kopyala-yapıştır yapacak. Ürünün "en kritik özellik" dediği akışın en sık tekrarlanan adımı manuel. Script engine olmadan çözülebilir: yanıt panelinde "bu alanı değişkene ata" (JSONPath seçimi) düğmesi yeterli.

#### O-2 — Performans mimarisi büyük dokümanlarda çöker
- Her tuş vuruşunda **tüm workspace** `structuredClone` ediliyor ([App.tsx:149-157](../apps/desktop/src/renderer/App.tsx:149)). Her istek `rawOperation`'ını, koleksiyon tüm `components`'i taşıdığı için birkaç yüz endpoint'lik gerçek bir Apinizer dokümanında URL alanına yazmak megabaytlarca klonlama demek.
- Import parse işlemi renderer thread'inde senkron ([App.tsx:309-330](../apps/desktop/src/renderer/App.tsx:309)) → büyük yapıştırmada UI donar.
- Export önizlemesi her state değişiminde yeniden serialize ediliyor ([App.tsx:131-147](../apps/desktop/src/renderer/App.tsx:131)).

**Öneri:** Immer benzeri yapısal paylaşım veya seçici klonlama; import/export'u main process'e veya worker'a taşı.

#### O-3 — Basic auth Türkçe karakterde patlıyor
`btoa` Latin-1 dışı karakterde exception fırlatır ([prepareHttpRequest.ts:122-133](../packages/core/src/http/prepareHttpRequest.ts:122)). Türkçe hedef kitlede `ş/ğ/ı` içeren parola → "Request failed: InvalidCharacterError". RFC 7617 uyumu için UTF-8 encode edip base64'le.

#### O-4 — Kötücül yapıştırılan doküman yüzeyi
- `resolveLocalRef` `#/__proto__` gibi segmentlerde prototype nesnelerine erişebiliyor ([shared.ts:108-132](../packages/core/src/importers/shared.ts:108)); bugün doğrudan istismar görünmüyor ama `__proto__`/`constructor` segmentlerini reddetmek ucuz bir sigorta.
- Dairesel `$ref` içeren şema `schemaToExample`'ı sonsuz özyinelemeye sokabilir mi kontrol edilmeli; `$ref` çözümü example üretiminde yapılmadığından bugün `{}` dönüyor ama gelecekte ref-takibi eklenince (Y-2 önerisi) derinlik sınırı şart.
- YAML alias bombası (`maxAliasCount` varsayılanı sınırlı olsa da) + çok büyük doküman = O-2 ile birleşip UI DoS.

#### O-5 — Header/path işleme pürüzleri
- Header adları case-sensitive objede tutuluyor ([prepareHttpRequest.ts:112-120](../packages/core/src/http/prepareHttpRequest.ts:112)); kullanıcı `content-type` yazarsa `Content-Type` otomatik eklemesiyle çakışabilir.
- Path param yerleştirme `:id` desenini URL'nin her yerinde `replaceAll` ile değiştiriyor ([prepareHttpRequest.ts:63-74](../packages/core/src/http/prepareHttpRequest.ts:63)) — `https://host/a:b` gibi URL'lerde yanlış ikame riski.
- GET body'si sessizce atılıyor ([prepareHttpRequest.ts:48](../packages/core/src/http/prepareHttpRequest.ts:48)); Elasticsearch tarzı GET-with-body API'lerde kullanıcıya haber verilmeden davranış değişiyor.
- Değişken çözümleme tek geçişli — `{{a}}` değeri `{{b}}` içeriyorsa çözülmez; `baseUrl` + ortam-bazlı kompozisyon senaryosunda sürpriz.

---

### DÜŞÜK / NOTLAR

- `formatBytes` MB/GB göstermiyor ([App.tsx:1410-1415](../apps/desktop/src/renderer/App.tsx:1410)).
- Response headers'ta aynı isimli çoklu header'lar (ör. `set-cookie`) tek değere iniyor.
- `secret` bayrağı otomatik ataması yalnızca `token|password` içeren isimlere bakıyor ([App.tsx:1387-1395](../apps/desktop/src/renderer/App.tsx:1387)); `apiKey`, `clientSecret` kaçıyor.
- Kayıt hatası kullanıcıya yalnızca küçük bir "Save failed" rozetiyle yansıyor; sebep gösterilmiyor.
- Test kapsamı 2 dosya; export doğruluğu (ürünün kalbi) için validator-destekli test yok.

---

## Ürün Düzeyi Red Team (kod dışı)

1. **Konumlandırma zayıflığı:** "Local-first, açık kaynak, hafif REST client" alanında Bruno neredeyse aynı vaadi veriyor (dosya tabanlı, offline, açık kaynak) ve OpenAPI import'u var. Sizin gerçek farklılaştırıcınız tek şey: **klasör seviyesinde OpenAPI export**. O halde tüm mühendislik kalitesi oraya yığılmalı — oysa bugün en kayıplı modül orası (Y-1, Y-2, K-2). Rakibin zayıf olduğu tek noktada zayıf olmak stratejik risk.
2. **"Export edilen dosya müşteriye mail atılır" varsayımı** güvenlik sorumluluğunu tamamen kullanıcıya bırakıyor; K-2'deki sızıntı taraması bir güvenlik özelliği değil, ürünün güven vaadinin kendisi olarak konumlandırılmalı ("gönderdiğin pakette sır yok garantisi").
3. **Kapsam dışı listesi sağlıklı** (script engine, runner, cloud yok) — bu disiplin korunmalı. Tek istisna: O-1'deki "yanıttan değişkene ata", script engine'e girmeden ana akışı tamamlayan asgari parça.
4. **Hedef kitlenin ortamı** (kurumsal ağ, iç CA, proxy) Y-3'te teknik bulgu olarak geçti ama ürün riski olarak da geçerli: ilk kullanıcı deneyi bir kurumsal ağda yapılmalı.

---

## Önceliklendirilmiş Aksiyon Listesi

| # | Aksiyon | Kapatır |
|---|---|---|
| 1 | Atomik yazma + bozuk dosyayı kenara alma + yedek rotasyonu | K-1, Y-4 |
| 2 | Export sızıntı taraması + unused-component pruning'i varsayılan yapma | K-2 |
| 3 | Path+method çakışma uyarısı | Y-1 |
| 4 | `rawOperation` temelli export (dokunulmamış alanları koru) + validator'lı golden testler | Y-2 |
| 5 | Timeout/iptal/boyut sınırı + iç CA/proxy desteği | Y-3 |
| 6 | `safeStorage` ile secret şifreleme | K-3 |
| 7 | Onay diyalogları + single instance lock | Y-4, Y-5 |
| 8 | Electron güncelleme, sandbox:true, imzalama | Y-5 |
| 9 | "Yanıttan değişkene ata" özelliği | O-1 |
| 10 | Import/export'u worker'a taşı, structuredClone'dan kurtul | O-2 |
