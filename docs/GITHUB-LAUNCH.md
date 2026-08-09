# GitHub Yayın ve Büyüme Rehberi

Bu dosya, projeyi yalnızca GitHub'a koymak yerine güven veren, kolay denenebilen ve paylaşılabilir bir source-available ürüne dönüştürmek için hazırlanmıştır.

## İsim kararı

Ürün ve GitHub deposu için **TaxCLI** adı seçildi:

<https://github.com/Taxperia/TaxCLI>

Kısa slogan:

> One local desktop for every AI coding CLI.

Adın hukuki marka uygunluğu garanti edilmez. Kararlı sürümden önce ilgili marka veri tabanlarında ve yazılım mağazalarında son kontrol yapılmalıdır.

## GitHub açıklaması

İngilizce ana açıklama:

```text
Local-first Windows desktop workspace for Codex, OpenCode, Cursor Agent, GitHub Copilot, Gemini CLI, and other AI coding agents.
```

Daha kısa seçenek:

```text
Run your AI coding CLIs from one local-first Windows desktop.
```

Türkçe tanıtım cümlesi:

```text
Codex, OpenCode, Cursor Agent, Copilot ve Gemini CLI'yi tek bir yerel Windows arayüzünden çalıştır.
```

## Topics

GitHub deposuna şu topic'leri ekle:

```text
ai-agents
ai-coding
coding-agents
codex
copilot
cursor
developer-tools
electron
gemini-cli
github-copilot
local-first
multi-agent
opencode
productivity
terminal
windows
```

Destek gerçek ve kararlı hale gelmeden `mcp`, `sandbox`, `secure`, `privacy-first` veya desteklenmeyen sağlayıcı adlarını topic olarak kullanma.

## Lisans

Bu depo **Taxperia Non-Commercial Attribution License** altında yayımlanır:

- Kişisel, eğitim, akademik, yardım amaçlı ve ticari olmayan kullanıma izin verir.
- Ticari kullanım için Taxperia'dan ayrı ve yazılı lisans alınmasını zorunlu tutar.
- Uygulama ve türetilmiş sürümlerde görünür `Created by Taxperia` veya `Based on TaxCLI by Taxperia` atfı ister.
- Lisans ve telif bildirimlerinin korunmasını zorunlu tutar.

Bu özel lisans OSI tanımına göre açık kaynak değildir; proje “source-available” olarak tanıtılmalıdır. Katkı kabul edilirken Taxperia'nın katkıları ayrı ticari koşullarla lisanslayabilmesi için `CONTRIBUTING.md` içindeki katkı lisansı şartı korunmalıdır. Önemli ticari kullanımlarda lisans metnini bir hukuk uzmanına inceletmek faydalıdır.

## Depoyu oluşturmadan önce

- `memory-bank/` ve kişisel görev notları `.gitignore` ile herkese açık deponun dışında tutulur.
- Tüm geçmişi secret taramasından geçir; `.gitignore` yalnızca gelecekteki eklemeleri önler.
- `provider-keys.json`, `.env`, auth dosyaları, loglar, ekran görüntüleri ve kişisel yollar olmadığını doğrula.
- README'e gerçek ürün ekran görüntüsü veya 20–40 saniyelik sıkıştırılmış GIF ekle.
- Uygulama logosu için kaynak ve lisans bilgisini doğrula.
- `npm ci` ve `npm run check` komutlarını temiz bir klasörde çalıştır.
- Alpha güvenlik sınırlamalarını README ve SECURITY dosyasında görünür bırak.

Önerilen taramalar:

```powershell
git status
git ls-files
npx secretlint "**/*"
npm audit
```

Tarama araçlarını çalıştırmadan önce paketlerini ve resmi kullanım belgelerini doğrula. `npm audit` bulgularını körlemesine `--force` ile düzeltme.

## GitHub depo ayarları

Depoyu oluşturduktan sonra:

1. Açıklama, topics ve sosyal önizleme görselini ekle.
2. **Issues**, **Discussions** ve **Preserve this repository** özelliklerini değerlendir.
3. **Private vulnerability reporting** özelliğini aç.
4. Varsayılan dal için pull request, status check ve force-push koruması ekle.
5. GitHub Actions izinlerini varsayılan olarak salt-okunur yap.
6. Secret scanning, push protection ve Dependabot'u etkinleştir.
7. İlk sürüme kadar release dosyalarını “pre-release” olarak işaretle.

## README'i dikkat çekici yapan unsurlar

İlk ekranda kullanıcı şu dört sorunun cevabını görmeli:

- Bu proje ne yapıyor?
- Neden mevcut terminal pencerelerinden daha iyi?
- Hangi sağlayıcılar gerçekten çalışıyor?
- Nasıl güvenli şekilde denerim?

En güçlü görsel sıralama:

1. Logo, ürün adı ve tek cümlelik değer önerisi
2. Gerçek ekran görüntüsü veya kısa demo
3. Üç ana fayda
4. İki dakikalık kurulum
5. Destek durumu ve dürüst alpha uyarısı
6. Güvenlik ve katkı bağlantıları

Sahte indirme sayısı, çalışmayan badge, “production ready”, “tam sandbox” veya doğrulanmamış performans iddiaları güveni azaltır.

## İlk release planı

İlk etiketi yerel Windows paketi doğrulandıktan sonra oluştur:

```text
v0.1.0
```

`.github/workflows/release.yml`, `v*` etiketi gönderildiğinde Windows installer'ını üretir, GitHub Release'e yükler ve otomatik güncelleme için `latest.yml` dosyasını yayınlar. Etiket ile `package.json` sürümü aynı olmalıdır.

Sonraki sürüm örneği:

```powershell
npm version patch
git push origin main --follow-tags
```

Kod imzalama eklenene kadar Windows SmartScreen uyarısı görülebilir. Release workflow başarılı olmadan etiketi veya release'i elle “latest” olarak işaretleme.

Release notlarında şunları yaz:

- Çalışan sağlayıcılar ve test edilen CLI sürümleri
- Windows sürümü
- Kurulum ve kaldırma adımları
- Bilinen sınırlamalar
- SHA-256 checksum
- Güvenlik uyarısı
- Bir sonraki milestone

## Star ve indirme ihtimalini artıran işler

- Tek komut veya tek installer ile kurulumu gerçekten çalışır hale getir.
- README'e kısa, sessiz ve altyazılı demo ekle.
- “Good first issue” olacak 5–10 küçük görev hazırla.
- Her sağlayıcı için destek matrisi ve örnek iş akışı yayınla.
- Hacker News, Reddit veya X paylaşımından önce temiz kurulum videosu hazırla.
- İlk kullanıcıların sorunlarına hızlı dön ve çözümü release notlarına taşı.
- Düzenli, küçük ve doğrulanabilir sürümler çıkar.
- Rakipleri küçümsemek yerine Windows-first, local-first ve çoklu CLI avantajını somutlaştır.

En önemli büyüme özelliği pazarlama metni değil, yeni bir kullanıcının beş dakika içinde güvenle çalışan bir sonuç alabilmesidir.
