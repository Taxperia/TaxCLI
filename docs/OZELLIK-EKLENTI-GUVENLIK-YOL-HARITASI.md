# TaxCLI Özellik, Eklenti ve Güvenlik Yol Haritası

Son güncelleme: 15 Ekim 2026

Bu belge TaxCLI'ye eklenen özelliklerin güncel durumunu, sonraki geliştirme adımlarını ve güvenlik gereksinimlerini tek yerde izlemek için hazırlanmıştır.

## Güncel durum

| Alan | Durum | Açıklama |
| --- | --- | --- |
| İlk açılış kurulum sihirbazı | Tamamlandı | Profil, CLI kurulum/giriş durumu, ilk güvenilir proje, snapshot, onay modu ve MCP tercihleri tek akışta yapılandırılır. |
| Proje başına birden fazla sohbet | Tamamlandı | Her proje altında bağımsız sohbet açma, sohbetler arasında geçiş ve sohbet bazında geçmiş saklama eklendi. |
| Sidebar proje ağacı | Tamamlandı | Projeler açılıp kapanabilir; sohbetler proje altında listelenir, silinebilir ve proje klasörü sağ-tık menüsünden açılabilir. |
| Arka planda sohbet çalıştırma | Tamamlandı | Bir sohbet çalışırken başka sohbete geçilebilir; akış ve sonuçlar doğru sohbete yönlendirilir. |
| Çoklu AI karşılaştırma | Güvenli kör koşu tamamlandı | Aynı prompt en az iki hazır AI'ya sırayla gönderilir. Her AI tek kullanımlık ayrı bir proje kopyasında çalışır ve sonucu ayrı sohbette görünür. |
| Tek kullanımlık varyant alanları | Tamamlandı | Kopyalar uygulama veri dizininde yalnız ilgili model başlamadan oluşturulur; süreç bitince ve sonraki model başlamadan silinir. |
| Canva | Tarayıcı bağlantısı tamamlandı | Canva, TaxCLI'nin kalıcı ve izole tarayıcı oturumunda açılır; kullanıcı kendi hesabıyla giriş yapar. |
| Google Drive | Tarayıcı bağlantısı tamamlandı | Drive, TaxCLI'nin kalıcı ve izole tarayıcı oturumunda açılır; kullanıcı kendi hesabıyla giriş yapar. |
| Gemini model kataloğu | Tamamlandı | Kurumsal/Google Cloud oturumunda Gemini CLI model takma adları, API anahtarı kullanıldığında ayrıca Google API'den canlı model listesi sunulur. Kişisel hesaplar için Google'ın Antigravity CLI geçişi ayrıca uygulanmalıdır. |
| Geri Alma / Snapshot | Tamamlandı | Manuel ve ajan-öncesi otomatik snapshot, hassas dosya hariç tutma, 20 sürümlük saklama ve geri alma öncesi güvenlik snapshot'ı eklendi. |
| Görev kuyruğu | Tamamlandı | Kalıcı sıra, duraklatma, hata sonrası yeniden deneme ve uygulama yeniden başladığında yarım görevi beklemeye alma eklendi. |
| Git merkezi | Tamamlandı | Durum, stage/unstage, depo başlatma, commit ve son commit geçmişi eklendi. |
| MCP mağazası | Tamamlandı | Doğrulanmış yayıncı kataloğu, sabit paket sürümleri ve izin/risk özeti yanında Gemini, Cursor ve Copilot proje dosyaları ile Codex/OpenCode çalışma zamanı yapılandırması eklendi. |
| Güvenlik Merkezi | Tamamlandı | Çalışma alanı güveni, DPAPI tabanlı kasa, hassas dosyada fail-closed koşu, süreç-sırrı/MCP ayrımı, redaksiyon ve DPAPI anahtarlı HMAC zincirli denetim kaydı eklendi. |

## 1. Özellik yol haritası

### 1.1 Çoklu sohbet

- Sohbet silme tamamlandı; yeniden adlandırma ve arşivleme sonraki aşamada.
- Sohbet arama ve tarih/model bazında filtreleme.
- Sohbeti başka projeye taşıma veya kopyalama.
- Her sohbet için kullanılan AI, model, çalışma dizini ve son durum bilgisini kalıcı gösterme.
- Eski tek-sohbet geçmişini kayıpsız taşıma ve sürümleme.

### 1.2 Çoklu AI karşılaştırma

İlk sürümde kullanıcı **+ → Çoklu AI karşılaştır** yoluyla en az iki hazır motoru ve her motor için kullanılacak modeli seçer. Mod, Plan modu gibi composer'a eklenir; kullanıcı daha sonra promptu yazıp Gönder'e bastığında TaxCLI kaynak projeye dokunmadan her motor için ayrı bir kopya oluşturur ve ajanları paralel başlatır.

Sonraki adımlar:

- Sonuçları yan yana gösteren karşılaştırma görünümü.
- Dosya, diff, test sonucu, süre ve tahmini maliyet karşılaştırması.
- Kazanan varyantı seçip ana projeye kontrollü taşıma.
- Taşımadan önce çakışma analizi ve dosya bazında seçim.
- Motor başına farklı model, efor ve sistem talimatı seçimi.
- Çalıştırma kuyruğu, eşzamanlı ajan sınırı, durdurma ve yeniden deneme.
- Aynı varyant üzerinde ikinci tur geri bildirim verme.
- Test komutunu tüm varyantlarda çalıştırıp ortak skor üretme.

### 1.3 Proje ve çalışma alanı

- Varyant klasörlerini uygulamadan açma ve güvenli biçimde temizleme.
- Büyük projelerde tam kopya yerine Git worktree veya copy-on-write seçeneği.
- Proje şablonları ve görev reçeteleri.
- Çalıştırma geçmişi, rapor dışa aktarma ve yeniden üretilebilir görev manifesti.

## 2. Eklenti yol haritası

### 2.1 Canva

**V1 — mevcut:** Güvenli tarayıcı paneli, kalıcı oturum ve ajan kontrollü sayfa etkileşimi.

**V2 — planlanan resmi entegrasyon:**

- Canva geliştirici uygulaması ve OAuth 2.0/PKCE.
- Kullanıcının tasarımlarını listeleme ve seçme.
- Tasarım oluşturma, dışa aktarma ve proje sohbetine ekleme.
- İşlem öncesi kapsam ve izin ekranı.

Resmi API sürümü için Canva uygulama kimliği, yönlendirme adresi ve onaylı OAuth kapsamları gerekir.

### 2.2 Google Drive

**V1 — mevcut:** Güvenli tarayıcı paneli, kalıcı oturum ve ajan kontrollü Drive kullanımı.

**V2 — planlanan resmi entegrasyon:**

- Google OAuth 2.0/PKCE ve mümkün olan en dar kapsamlar.
- Önce `drive.file`; yalnızca ihtiyaç varsa daha geniş, kullanıcı onaylı kapsam.
- Dosya seçici, yükleme, indirme ve proje-sohbet eki oluşturma.
- Paylaşım değişikliklerinden önce açık onay.
- Token iptali ve bağlı hesap yönetimi.

Resmi API sürümü için Google Cloud OAuth istemcisi, doğrulanmış yönlendirme adresi ve izin ekranı yapılandırması gerekir.

### 2.3 Ortak eklenti altyapısı

- Eklenti manifesti: kimlik, sürüm, izinler, alan adları ve veri erişimi.
- Proje bazında izin listesi.
- Eklenti bağlantısını kaldırma ve token iptal etme.
- Eklenti işlemleri için denetim günlüğü.
- MCP tabanlı entegrasyonlar için ayrı aç/kapat ve sunucu güven listesi.

## 3. Güvenlik güncelleştirmeleri

Uygulanan temel katmanlar: sağlayıcı anahtarlarının `safeStorage` ile şifrelenmesi ve eski kayıtların taşınması; çalışma alanı güveni; hassas dosya/symlink/boyut filtreli kopya ve snapshot; webview izin, indirme, popup ve gezinme sınırları; eklenti dış alan onayı; tehlikeli terminal komutu engeli; prompt-injection talimat ayrımı; log redaksiyonu; ajan süre/eşzamanlılık/çıktı/bellek kotaları ve ortam değişkeni izin listesi; DPAPI korumalı anahtarla HTTPS mobil köprü; `unsafe-inline` içermeyen CSP; merkezî IPC gönderici/yapı/boyut doğrulaması; ASAR bütünlüğü ve kısıtlayıcı Electron fuse'ları; imzalı güncelleme doğrulama ayarı; hash zincirli ve dışa aktarılabilir denetim kaydı; güvenlik regresyon testleri; haftalık bağımlılık taraması ve CycloneDX SBOM üretimi.

Windows yayın akışı sertifika sırlarını kabul edecek, imzasız yükleyiciyi reddedecek, SBOM ve SHA-256 toplamlarını yayımlayacak şekilde hazırdır. Gerçek kod imzalama sertifikası, Canva/Google OAuth uygulama kayıtları, işletim sistemi seviyesinde ağ/CPU/bellek sandbox'ı ve bağımsız güvenlik incelemesi uygulama kodundan ayrı dağıtım kimlikleri veya altyapı gerektiren teslim kalemleri olarak kalır.

### Öncelik 0 — yayımdan önce

- API anahtarlarını düz dosya yerine Windows Credential Manager/DPAPI ile şifreli saklama.
- Çoklu-AI kopyalarında yol sınırı doğrulaması, sembolik bağlantı/junction reddi ve disk kotası.
- Varyant klasörüne yazılan her dosya için kaynak proje dışına taşma kontrolü.
- Webview izin politikası: kamera, mikrofon, konum, bildirim, indirme ve yeni pencere varsayılan olarak kapalı.
- Canva/Drive gezinmesini izin verilen HTTPS alan adlarıyla sınırlandırma; dış alan adı geçişinde kullanıcı onayı.
- İçerik Güvenlik Politikası'nı daraltma ve inline script/style bağımlılıklarını kaldırma — tamamlandı.
- IPC girişlerinde gönderici, yapı, derinlik ve boyut sınırlarını merkezileştirme; yol kullanan servislerde mutlak yol/kapsama kontrolü — tamamlandı.

### Öncelik 1

- OAuth için Authorization Code + PKCE; istemci sırrını masaüstü uygulamaya gömmeme.
- Tokenları şifreli saklama, süre dolumu/yenileme ve tek tıkla iptal.
- Prompt injection sınırları: web sayfası, eklenti verisi ve kullanıcı talimatını ayrı güven seviyelerinde işleme.
- Shell komutlarında proje sınırı, tehlikeli komut sınıflandırması ve açık kullanıcı onayı.
- Paralel ajanlarda işlem, CPU, bellek, süre ve disk sınırları.
- Hassas dosyalar için varsayılan engel listesi: `.env`, özel anahtarlar, kimlik depoları ve tarayıcı profilleri.
- Loglarda anahtar, token, çerez ve kişisel veri maskeleme.

### Öncelik 2

- İmzalı güncelleme paketi ve güncelleme bütünlük doğrulaması.
- SBOM üretimi, bağımlılık zafiyet taraması ve otomatik güvenlik güncellemeleri.
- Eklenti paketlerinde imza ve yayıncı doğrulaması.
- Denetim günlüğünü dışa aktarma ve değiştirilmeye karşı zincirleme özet.
- Güvenlik regresyon testleri: path traversal, symlink kaçışı, kötü niyetli webview yönlendirmesi ve IPC fuzz testleri.

## 4. Çoklu-AI kabul kriterleri

- Kaynak proje dosyaları karşılaştırma başlatılırken değişmez.
- Her seçili AI farklı mutlak çalışma dizininde çalışır.
- Bir AI'nın çıktısı başka AI'nın sohbetine yazılmaz.
- Bir süreç hata verse bile diğer süreçler devam eder.
- Kullanıcı her çalışmayı bağımsız durdurabilir ve sonucunu daha sonra açabilir.
- Varyantın ana projeye alınması otomatik değil, önizlemeli ve onaylıdır.

## 5. Önerilen teslim sırası

1. Çoklu sohbet ve izole çoklu-AI temel akışı — tamamlandı.
2. Karşılaştırma ekranı, test skoru ve kazanan varyantı seçme.
3. Güvenli birleştirme/taşıma ve varyant temizleme.
4. Canva ile Drive için resmi OAuth/API bağlantıları.
5. Kimlik kasası, izin manifesti, webview sıkılaştırması ve güvenlik testleri.
