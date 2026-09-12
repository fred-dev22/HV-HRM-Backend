import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

// Portail carriere public. Le CV est un vrai fichier televerse (partie
// multipart `cv`), plus un simple nom : le champ CvFileName a ete retire.
export class PublicApplyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  CandidateName: string;

  @IsEmail()
  CandidateEmail: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  CandidatePhone: string;

  // --- Anti-spam du portail carriere ---
  // Website / Fax sont des champs POT-DE-MIEL : invisibles pour un humain
  // (positionnes hors ecran cote SPA), ils DOIVENT quand meme etre declares
  // ici car le ValidationPipe global tourne avec forbidNonWhitelisted:true —
  // un bot qui les remplit serait sinon rejete par un 400 generique, ce qui
  // trahirait la detection. Declares + ignores cote service, le rejet reste
  // silencieux (meme reponse qu'une vraie candidature).
  @IsOptional()
  @IsString()
  @MaxLength(200)
  Website?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  Fax?: string;

  // Jeton de formulaire HMAC sans etat (emis par GET /public/careers/form-token
  // ou embarque dans GET /public/careers/:token). Verifie l'age du formulaire
  // et l'usage unique.
  @IsOptional()
  @IsString()
  @MaxLength(400)
  FormToken?: string;

  // Jeton Cloudflare Turnstile (facultatif : present seulement si
  // VITE_TURNSTILE_SITE_KEY est configure cote SPA).
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  CaptchaToken?: string;
}
