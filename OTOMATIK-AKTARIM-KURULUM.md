# Otomatik sonuç aktarımı kurulumu

Bu otomasyon dört oyunun güncel sonuçlarını Milli Piyango Online sonuç sayfalarından tarayıcıyla okur, iki aşamada doğrular ve Supabase'e ekler.

## Güvenlik ve kayıt davranışı

- Manuel sonuç girmeye devam edebilirsiniz.
- Aynı oyun ve tarihte sonuç tamamen aynıysa kayıt çoğaltılmaz; yalnızca resmî kaynak bilgisi güncellenir.
- Aynı tarih veya aynı yıl/çekiliş numarası için farklı bir sonuç varsa mevcut kayıt **değiştirilmez**. Olay `loto_sync_conflicts` tablosuna yazılır.
- Supabase gizli anahtarı site koduna konmaz. Yalnızca GitHub Actions kasasında tutulur.
- Her çalışma `loto_sync_runs` tablosuna kaydedilir.

## 1. Supabase veritabanını hazırlayın

1. Supabase panelinde projenizi açın.
2. **SQL Editor > New query** yoluna gidin.
3. Projedeki `supabase-automation.sql` dosyasının tamamını yapıştırın ve **Run** düğmesine basın.
4. Hata olmadan tamamlandığını doğrulayın.

Bu dosya daha önce çalıştırdığınız `supabase-rls.sql` dosyasından sonra çalıştırılmalıdır. Tekrar çalıştırılması güvenlidir.

## 2. Projeyi özel bir GitHub deposuna yükleyin

GitHub Actions zamanlayıcısının çalışabilmesi için proje GitHub'da bulunmalıdır. Depoyu mümkünse **Private** oluşturun. `node_modules` klasörünü yüklemeyin.

## 3. GitHub gizli bilgilerini ekleyin

GitHub deposunda **Settings > Secrets and variables > Actions > New repository secret** bölümüne iki gizli bilgi ekleyin:

1. `SUPABASE_URL`: Supabase proje adresiniz. Örnek biçim: `https://proje-kodu.supabase.co`
2. `SUPABASE_SECRET_KEY`: Supabase **Settings > API Keys** bölümündeki yeni `sb_secret_...` anahtarı. Yeni gizli anahtar görünmüyorsa eski `service_role` anahtarı kullanılabilir.

Bu anahtarı HTML/JavaScript dosyalarına yazmayın, ekran görüntüsünde paylaşmayın ve kimseye göndermeyin.

## 4. İlk çalışmayı elle başlatın

1. GitHub deposunda **Actions > Loto sonuçlarını eşitle** sayfasını açın.
2. **Run workflow** düğmesine basın.
3. İşlem yeşil tamamlanınca Supabase SQL Editor'da şu kontrolleri çalıştırın:

```sql
select * from public.loto_sync_runs order by id desc limit 10;
select * from public.loto_sync_conflicts
where resolved_at is null
order by detected_at desc;
```

İlk sorguda `status = success` ve ikinci sorguda sıfır satır beklenir. `conflict` görünürse otomasyon kaydı ezmemiştir; manuel kayıt ile resmî sonucu karşılaştırmak gerekir.

## Site içindeki manuel kontrol düğmesi

`Online sonuçları kontrol et` düğmesi, yönetici oturumunu Supabase'de doğrulayan `trigger-loto-sync` Edge Function üzerinden GitHub iş akışını başlatır. GitHub anahtarı site JavaScript'ine yazılmaz.

1. GitHub'da yalnız `AlpEfendi/lotoanaliz` deposuna erişen bir fine-grained personal access token oluşturun. Repository permission olarak **Actions: Read and write** verin.
2. Supabase **Edge Functions > Secrets** bölümüne `GITHUB_ACTIONS_TOKEN` adıyla bu anahtarı ekleyin.
3. Supabase CLI ile projeyi bağlayıp fonksiyonu dağıtın:

```powershell
npx supabase login
npx supabase functions deploy trigger-loto-sync --project-ref etljhwfxqqtuhmxnajqj --use-api
```

Bu gizli anahtarı site dosyalarına, GitHub deposuna veya sohbet ekranına yapıştırmayın. Düğme yalnız `loto_admins` tablosundaki oturum açmış yönetici tarafından kullanılabilir.

## Çalışma sıklığı

`.github/workflows/loto-sync.yml` otomasyonu Türkiye saatiyle yaklaşık **00:30** ve **04:30**'da çalıştırır. Her çalışmada mevcut ayla birlikte önceki ay da taranır. Sonuç henüz yayımlanmamışsa bir sonraki çalışmada alınır. GitHub zamanlanmış işleri yoğunluk nedeniyle birkaç dakika geciktirebilir.

## Yerel kuru test

Node.js 22 yüklüyse proje klasöründe:

```powershell
npm ci
npx playwright install chromium
$env:LOTO_HEADLESS='false'
npm run sync:loto:dry
```

Kuru test Supabase'e veri yazmaz; sadece okunan ve doğrulanan sonuçları ekrana basar.

## Durdurma

GitHub'da **Actions > Loto sonuçlarını eşitle > Disable workflow** ile otomatik çalışmayı durdurabilirsiniz. Manuel veri girişi bundan etkilenmez.

## Not

Otomasyon resmî sonuç sayfalarının mevcut HTML yapısına bağlıdır. Site yapısı değişirse işlem güvenli biçimde hata verir ve veri yazmaz; Actions çalışmasında `loto-sync-error` ekran görüntüsü oluşur. Kaynak sitenin kullanım koşulları ve erişim kuralları ayrıca gözetilmelidir.
