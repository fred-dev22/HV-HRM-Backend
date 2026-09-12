// Constantes partagees du module Recrutement. Aucun circuit de validation
// (decision client du 05/09) : les jeux de statuts sont volontairement
// courts, et il n'y a pas d'etape "approuver / refuser" sur une offre ni
// une expression de besoin.

// ── Prefixes des codes de reference (BES001, OFF001, ...) — meme convention
// courte que le matricule employe (EmployeeService.generateEmployeeNumber ->
// EMP001), demande client du 11/09 ("ça doit être parlant comme pour le
// module administration"). Remplace l'ancien format PREFIX-ANNEE-00001.
export const REFERENCE_PREFIXES = {
  hiringRequest: 'BES', // BESoin
  jobOffer: 'OFF', // OFFre
  application: 'CAN', // CANdidature
  interview: 'ENT', // ENTretien
  contract: 'CTR', // ConTRat
  trial: 'ESS', // ESSai (periode d'essai)
  talentPool: 'VIV', // VIVier de talents
} as const;

// ── Jeux de statuts ─────────────────────────────────────────────────────
export const HIRING_REQUEST_STATUSES = ['Draft', 'Open', 'Closed', 'Cancelled'] as const;
export const JOB_OFFER_STATUSES = ['Draft', 'Published', 'Closed'] as const;
export const APPLICATION_STATUSES = ['New', 'InReview', 'InterviewScheduled', 'Retained', 'Rejected'] as const;
export const APPLICATION_SOURCES = ['Offer', 'Spontaneous', 'Internal'] as const;
export const INTERVIEW_STATUSES = ['Scheduled', 'Done', 'Cancelled'] as const;
export const INTERVIEW_MODES = ['InPerson', 'VideoCall'] as const;
export const CONTRACT_STATUSES = ['Draft', 'Sent', 'Negotiating', 'Accepted', 'Refused', 'Cancelled'] as const;
export const TRIAL_STATUSES = ['OnTrial', 'Extended', 'Converted', 'Cancelled'] as const;
export const TALENT_POOL_STATUSES = ['Open', 'Closed'] as const;

// Statuts d'une candidature ou l'on peut encore modifier / supprimer.
export const APPLICATION_EDITABLE_STATUSES = ['New', 'InReview'];

// Duree par defaut d'une periode d'essai (mois) — appliquee a la creation
// automatique lorsqu'une proposition d'embauche est acceptee.
export const TRIAL_PERIOD_MONTHS = 2;

// Rendu client : "Galana" devient "HV" dans tout le module (retour reunion
// du 05/09). Applique aux libelles seedes (modeles de contrat) et a tout
// texte genere cote backend.
export const CLIENT_SHORT_NAME = 'HV';

// ── Diffusion multi-plateformes des offres (backlog) ────────────────────
export const DISTRIBUTION_CHANNEL_KINDS = ['Webhook', 'RssOnly', 'Manual', 'Email'] as const;
export const JOB_OFFER_DISTRIBUTION_STATUSES = ['Pending', 'Sent', 'Failed', 'Posted', 'Skipped'] as const;
export const DISTRIBUTION_TRIGGERS = ['Publish', 'Close', 'Manual'] as const;
// Delai max d'un POST webhook sortant (relais Zapier/Make/n8n).
export const WEBHOOK_TIMEOUT_MS = 8_000;
// Cache de rendu des flux publics feed.json / feed.xml.
export const FEED_RENDER_TTL_MS = 60_000;
// Longueur max d'une description d'offre dans les flux (coupe proprement).
export const FEED_DESCRIPTION_MAX = 5_000;
// RSVP entretien : delai (min) d'une invitation calendrier.
export const INTERVIEW_DEFAULT_DURATION_MIN = 60;

// ── Conversion candidat -> employe (backlog) ────────────────────────────
// Type de contrat cote Recrutement (FR) -> enum Employee (EN, voir
// CreateEmployeeDto.ContractType). Aligne sur src/stores/employees.ts
// (CONTRACT_TYPE_TO_BACKEND) cote frontend.
export const RECRUITMENT_TO_EMPLOYEE_CONTRACT_TYPE: Record<string, string> = {
  CDI: 'Permanent',
  CDD: 'FixedTerm',
  Stage: 'Internship',
  Freelance: 'Freelance',
  Apprenti: 'Apprenticeship',
  Alternant: 'WorkStudy',
  // Variantes / libelles longs rencontres dans les modeles de contrat seedes.
  Apprentissage: 'Apprenticeship',
  Alternance: 'WorkStudy',
  Essai: 'Permanent',
};
