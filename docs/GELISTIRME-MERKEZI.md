# Geliştirme merkezi

Sol menüdeki **Geliştirme merkezi**, seçili projenin AI çalışma sonuçlarını yönetir.

## İnceleme

Bir çalışmayı açarak dosya ve değişiklik bloklarını seçin. Ana projede yapılmış bir çalışmada **Kabul et** inceleme kararını kaydeder; **Geri al** yalnızca seçilen değişiklikleri tersine çevirir. İzole sonuçta **Ana projeye uygula** seçilen dosya veya blokları taşır. İşlem öncesi dosya içerikleri doğrulanır; çalışma sonrasındaki kullanıcı değişiklikleriyle çakışma varsa hiçbir dosya yazılmaz. Dosya yazılan işlemler önce bir güvenlik snapshot’ı oluşturur.

İkili dosyalar dosya bütününde incelenir. Büyük metinlerde fark hesaplamasının belleğini sınırlamak için tek blok kullanılabilir. Kaynak kayıtları hassas dosyaları, bağlantıları, bağımlılık ve derleme klasörlerini içermez; inceleme başlangıç kaydı 64 MB ile sınırlıdır. Normal AI görevleri bu sınır aşıldığında da çalışır: model/efor, yanıt, kullanım ve zaman çizelgesi tutulur; dosya inceleme ve geri alma kaydının oluşturulmadığı açıkça gösterilir. Arena ve dal kopyaları eksik başlangıç dosyalarıyla oluşturulmaz.

## Model Arena

Composer’da **+ → Çoklu AI karşılaştır** üzerinden aynı veya farklı sağlayıcılardan modelleri, hakem sağlayıcı/modelini ve otomatik test seçeneğini belirleyin. Görevi gönderdiğinizde:

1. Projenin tek bir başlangıç kopyası şifrelenerek saklanır.
2. Her model aynı başlangıçtan kendi klasöründe sırayla çalışır.
3. Tanımlı testler çalışır. Gerekirse npm bağımlılıkları yalnız yerel önbellekten, kurulum betikleri çalıştırılmadan hazırlanır; eksik önbellek ve başarısız testler raporlanır.
4. Çözüm kaydı şifrelenir ve etkin klasör sonraki model başlamadan temizlenir.
5. Ayrı hakem salt okunur bir koşuda anonim çözüm raporlarını ve test kanıtını değerlendirir.
6. Kullanıcı sonucu inceleyerek seçtiği dosya/blokları ana projeye uygular.

Puan ağırlıkları test %35, hakem kalitesi %40, hız %15, maliyet %10’dur. Eksik veri hesap dışıdır. Test veya hakem sonucu yoksa puan geçici olarak işaretlenir. Test puanı keşfedilen test komutlarının başarı oranıdır; tek tek test vakalarının sayısını temsil etmez. Maliyet yalnız sağlayıcı bildirdiğinde ve para birimleri eşleştiğinde karşılaştırılır. Başarısız testli bir aday hakem kazananı olarak kabul edilmez. Bir çözüm yeniden test edildiğinde Arena puanları da güncellenir; önceki kazanan ve hakem puanları kaldırılır ve yeni değerlendirme istenir.

Bu, uygulama düzeyinde kör ve sıralı karşılaştırmadır. Aynı Windows kullanıcısı altında çalışan kötü niyetli bir CLI sürecine karşı VM/container izolasyonu sağlamaz. Sağlayıcı izinleri geçerliliğini korur.

## Çalışma kaydı

Model, efor, süre, token kaynağı, bildirilen maliyet, dosya farkları ve sağlayıcının bildirdiği araç/komut/izin olayları kaydedilir. **Aynı ayarlarla yeniden çalıştır** kayıtlı bağlamla yeni bir koşu açar. İzole bir sonucun tekrarı, kayıtlı başlangıç dosyalarından oluşturulan yeni geçici klasörde çalışır; ana proje dosyalarını değiştirmez. Normal proje koşusu kendi kaynak projesinde tekrar açılır. Geçici tekrar klasörü kayıt tamamlandıktan sonra, başlatma hatasında da temizlenir. Bu, deterministik sonuç garantisi vermez. Zaman çizelgesi işletim sistemi düzeyinde eksiksiz dosya erişim günlüğü değildir. Raporlar hassas değerler temizlenerek dışa aktarılır.

## Görev tarifleri

Bug düzeltme, test yazma, kod inceleme ve sürüm hazırlığı tarifleri hazırdır. Kendi adımlarınızı ayrı satırlarda kaydedebilirsiniz. Tarif, adımları sırayla uygulayıp kanıtlarını raporlaması için seçili ajana verilir; her adım ayrı bir model çağrısı değildir.

## Proje sağlığı

npm test/lint/typecheck/check, Cargo, Go veya pytest kontrolleri proje dosyalarından keşfedilir. **Kontrolleri göster** çalışacak komutları listeler. **Kontrolleri çalıştır** güvenilen projenin betiklerini çalıştırır. npm audit/outdated için ağ seçeneğini işaretleyin. Test olmayan proje başarılı test olarak sunulmaz. README, TODO/FIXME ve yaklaşık satır/dallanma göstergeleri ayrıca raporlanır. Kaynak göstergeleri kesin AST karmaşıklık analizi değildir.

## Konuşma dalları

Mesaj üstündeki **Buradan dallandır** ile sağlayıcı ve dal adı seçin. Mesajla ilişkili bir çalışma kaydı varsa o çalışmanın dosya durumu, yoksa mevcut proje durumu başlangıç alınır. Dalın sonraki koşuları ayrı kopyada çalışır. **Dallar** sekmesinden dosya farklarını veya iki dalın son tamamlanan çalışmalarını karşılaştırıp sonucu ana projeye uygulayın. Sonradan değişmiş ana proje dosyaları çakışma olarak korunur.

## Bilgi kasası

Markdown, TXT, JSON, YAML, CSV, HTML ve metin içeren PDF dosyaları eklenebilir. Belgeyi bu projeye veya bütün projelere bağlayın. İşaretli belgeler yeni görevlere referans olarak eklenir; **+ → Bilgi belgelerini seç** doğrudan bu ekranı açar. Toplam bilgi bağlamı koşu başına 24.000 karakterdir. PDF taraması OCR içermez. Belgeler yerelde Windows kasasıyla şifrelenir; kullanıldığında seçili sağlayıcıya gönderilir.

## Sağlayıcı doktoru

Resmî CLI kurulumunu, sürümü, oturumu ve model listesini inceler. Kurulum veya giriş gerektiğinde resmî CLI akışını açar. Model kataloğunda görünmek model erişim yetkisi garantisi değildir. 403 hatası hesap yetkisi veya kurum politikası kontrolünü gerektirebilir. Teşhis raporu dışa aktarılabilir.

## Oturum aktarımı

Yerel tarama desteklenen Codex, Claude, Gemini ve OpenCode konuşma klasörlerini inceler. Diğer CLI/terminallerden JSON, JSONL, Markdown veya metin kaydı seçilebilir. Codex ve Claude mesajları, Gemini konuşmaları, OpenCode dosya tabanlı oturumları ve User:/Assistant: metin dışa aktarımları desteklenir. Yeni veritabanı biçimleri için dışa aktarım dosyası kullanılmalıdır.

Aktarım kaynak dosyayı değiştirmez ve en son 200 konuşma mesajını yeni TaxCLI sohbetine taşır. Çalışan terminal, gizli araç durumu, kimlik belirteçleri veya sağlayıcının canlı oturum kimliği taşınmaz.
