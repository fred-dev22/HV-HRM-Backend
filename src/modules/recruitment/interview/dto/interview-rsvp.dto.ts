import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

// Reponse envoyee depuis la page publique (lien du mail d'invitation). Les
// valeurs sont en minuscules cote lien public (?response=accepted|declined|
// tentative) ; le service les convertit vers les libelles stockes en base
// (Pending | Accepted | Declined | Tentative).
export class RsvpResponseDto {
  @IsIn(['accepted', 'declined', 'tentative'])
  Response: 'accepted' | 'declined' | 'tentative';
}

// Correction manuelle d'une reponse par un RH (route authentifiee
// /recruitment/interviews/:id/rsvp). Target = 'candidate' pour la reponse du
// candidat, sinon l'Id (UUID) d'une ligne InterviewParticipant de cet
// entretien. Response accepte 'Pending' pour remettre a zero.
export class ManualRsvpDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  Target: string;

  @IsIn(['Pending', 'Accepted', 'Declined', 'Tentative'])
  Response: 'Pending' | 'Accepted' | 'Declined' | 'Tentative';
}

// Corps de /public/interview-rsvp/inbound-ics (mecanisme secondaire optionnel,
// actif seulement si RSVP_INBOUND_SECRET est defini). Le relais de messagerie
// (regle de transfert / n8n / Make) poste la partie calendrier en chaine JSON,
// main.ts ne configurant aucun parseur text/calendar.
export class InboundIcsDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20000)
  Ics: string;
}
