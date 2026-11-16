# Aizvietošana — iestatīšana

**Kā tas strādā:** lietotne (šī repozitorija saknē) atrodas GitHub Pages, dati glabājas Google Sheets, Apps Script ir API, bet push paziņojumus sūta Firebase.

| Loma | Ko redz un dara |
|---|---|
| **Darbu vadītājs** | Formā izvēlas adresi no objektu saraksta un darbu no saraksta. Vienā reizē var pieteikt vairākas adreses. Redz savus pieteikumus un to, kura brigāde tos dabūja. |
| **Admins** | Katrai dienai norāda brigāžu sastāvu (vienu vai vairākus cilvēkus). Redz visus pieteikumus, piešķir brigādes un spiež **Publicēt**: brigādes saņem push paziņojumu. Var arī nokopēt WhatsApp tekstu. |
| **Brigāde** | Redz savus objektus (pēc publicēšanas) un atver tos kartē. Atzīmē **Izpildīts**, var pievienot līdz 4 foto un komentāru. Ja darbu nevar izdarīt, spiež **Nevar izpildīt** un norāda iemeslu. |

Paziņojumi: **jauns pieteikums** → adminiem · **publicēts plāns** → brigādēm · **izpildīts** → vadītājam · **nevar izpildīt** → adminiem un vadītājam.

---

## 1. Google Sheets + Apps Script

1. Izveido jaunu Google Sheets tabulu, piemēram, „Darbu sadale”.
2. **Paplašinājumi → Apps Script**, ielīmē `apps-script/Code.gs` un saglabā.
3. Augšā izvēlies funkciju **setup** → **Run** (atļauj piekļuvi). Tiek izveidotas lapas *Lietotaji*, *Darbi* un *Tokeni*.
4. Lapā **Darbinieki** ievadi cilvēku vārdus. Kolonnā *Pamatbrigade* var norādīt brigādi, kurā cilvēks parasti strādā: tad viņš tur parādās automātiski. Konkrētas dienas sastāvu admins maina lietotnē (**Mainīt** pie brigādes), un tas saglabājas lapā **Sastavs**.
5. Lapā **Objekti** ievadi adreses. Kolonnā *Vaditajs* var norādīt, kuram vadītājam objekts pieder: viņam tas rādās saraksta augšā. Jaunas adreses no pieteikumiem tiek pievienotas automātiski. Lapā **DarbuVeidi** ir darbu saraksts ar grupām *Aizvietošana* un *Papilddarbs*, un to var brīvi papildināt.
6. Lapā **Lietotaji** ievadi īstos vārdus un **4 ciparu PIN**. Lomas: `admin`, `vaditajs`, `brigade`. Brigādes nosaukums ir arī tās pieteikšanās vārds (viens PIN uz brigādi).
7. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
8. Nokopē Web app URL (beidzas ar `/exec`).

> Pēc katrām koda izmaiņām: **Deploy → Manage deployments → ✏️ → Version: New version**, lai URL paliktu tas pats.

## 2. GitHub Pages

1. Izveido GitHub repozitoriju `aizvietosana` (tāpat kā `izvesana`).
2. Augšupielādē visus šīs mapes failus repozitorija saknē.
3. Failā `config.js` ievadi `API_URL` (no 1. soļa).
4. **Settings → Pages → Branch: main / (root) → Save**. Adrese būs `https://vaitkevix.github.io/aizvietosana/`.

Šajā brīdī lietotne jau strādā, tikai vēl bez paziņojumiem.

## 3. Push paziņojumi (Firebase, bezmaksas)

1. Atver [console.firebase.google.com](https://console.firebase.google.com) → **Add project**.
2. **Project settings → General → Your apps → Web (</>)** → reģistrē un nokopē `firebaseConfig` vērtības uz `config.js` → `firebase`.
3. **Project settings → Cloud Messaging → Web Push certificates → Generate key pair** → atslēgu ievadi `config.js` → `VAPID_KEY`.
4. **Project settings → Service accounts → Generate new private key** → lejupielādējas JSON fails.
5. Apps Script → **Project Settings (⚙️) → Script properties**:
   - `FCM_SERVICE_ACCOUNT` = viss JSON faila saturs
   - `APP_URL` = GitHub Pages adrese ar `/` beigās
6. Apps Script → **Deploy → Manage deployments → New version** (jāatļauj ārējie pieprasījumi).
7. Augšupielādē atjaunināto `config.js` GitHub.

> JSON atslēga ir tikai Apps Script. **Nekad neliec to GitHub.** `config.js` vērtības nav slepenas, tās drīkst būt publiskas.

## 3b. AI piezīmes (nav obligāti)

Poga **✨ Uzlabot ar AI** pārraksta piezīmi, komentāru vai iemeslu skaidrā latviešu valodā. Apps Script → **Script properties** pievieno vienu no šīm atslēgām:
- `ANTHROPIC_API_KEY`: Claude atslēga no [console.anthropic.com](https://console.anthropic.com). Noklusējuma modelis ir `claude-haiku-5-5`.
- **vai** `GEMINI_API_KEY`: Google Gemini atslēga no [aistudio.google.com](https://aistudio.google.com) (ir bezmaksas līmenis). Noklusējuma modelis ir `gemini-2.5-flash`.
- Ja vajag citu modeli, norādi to ar `AI_MODEL` (nav obligāti).

Ja atslēgas nav, poga parāda paziņojumu, ka AI nav iestatīts. Pārējā lietotne strādā normāli.

## 4. Uz iPhone (iOS 16.4+)

1. Safari atver GitHub Pages adresi.
2. **Kopīgot → Pievienot sākuma ekrānam**.
3. Atver lietotni no ikonas un ievadi PIN.
4. **⋯ → Ieslēgt paziņojumus → Atļaut**, pēc tam **Sūtīt testa paziņojumu**.

Push paziņojumi iPhone darbojas tikai tad, ja lietotne ir atvērta no sākuma ekrāna ikonas, nevis no Safari cilnes. Android un datorā pietiek ar Chrome.

## Piezīmes
- PIN ir vienkārša iekšēja aizsardzība, ne bankas līmeņa drošība. Nedod brigādēm admina PIN.
- Ja admins pēc publicēšanas maina brigādi vai vadītājs labo darbu, tas kļūst **Nepublicēts**. Pēc tam vēlreiz spied **Publicēt**: paziņojumu saņem tikai par jaunajām izmaiņām.
- Viens cilvēks vienā dienā var būt tikai vienā brigādē. Ja viņu atzīmē citā brigādē, viņš tiek pārcelts.
- Jau uzstādītai tabulai atjauno kodu un vēlreiz palaid **setup**: tiks pievienotas trūkstošās lapas (*Darbinieki*, *Sastavs*, *Objekti*, *DarbuVeidi*), bet esošie dati paliks.
- Foto glabājas tavā Google Drive mapē **„Darbu sadale — foto”**, un tās tiek koplietotas ar saiti, lai bildes rādās lietotnē. Ja uzņēmuma Google konts neļauj koplietot ar saiti, bildes redzēs tikai tā paša uzņēmuma konti.
- Pirmo reizi pēc atjaunināšanas palaid **setup**, lai Google prasa atļauju Drive (foto saglabāšanai) un tabulai pievienotu kolonnas *Komentars*, *Foto*, *Iemesls*.
- **Atvaļinājums**: ja aizvietošanas darbam atzīmē „Aizvietojamais ir atvaļinājumā” un datumu „līdz”, darbs tiek izveidots katrai darba dienai (vai arī brīvdienās, ja to atzīmē), ne vairāk kā 62 dienas. Dzēšot var izvēlēties dzēst tikai vienu dienu vai visu atlikušo periodu.
- Visus datus var skatīt un labot arī tieši tabulā.


© VAITKEVIX, SIA. Visas tiesības aizsargātas.
