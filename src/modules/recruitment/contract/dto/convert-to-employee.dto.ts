import { PartialType } from '@nestjs/mapped-types';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

// Champs collectes dans la modale "Creer le profil employe" (conversion d'un
// contrat accepte en employe reel du module Employes). Ce que le recrutement
// connait deja n'est PAS dans ce DTO : le nom du candidat (decoupe en
// prenom/nom cote serveur, corrigeable via FirstName/LastName), la date de
// debut du contrat (-> HireDate), le type de contrat du modele/de l'offre
// (-> ContractType), le telephone/email du candidat. Le ValidationPipe global
// ({whitelist, forbidNonWhitelisted, transform}) rejette donc tout envoi de
// Salary / JobTitle / StartDate / Status.
export class ConvertContractToEmployeeDto {
  // Par defaut deduit de RecruitmentContract.CandidateName : dernier mot = nom,
  // le reste = prenom. Renseigne seulement pour corriger le decoupage.
  @IsOptional()
  @IsString()
  @MaxLength(100)
  FirstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  LastName?: string;

  @IsIn(['M', 'F'])
  Gender: string;

  @IsDateString()
  BirthDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  BirthPlace?: string;

  @IsIn(['Single', 'Married', 'Divorced', 'Widowed'])
  MaritalStatus: string;

  @IsIn(['NationalId', 'Passport', 'ResidencePermit'])
  IdType: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  IdNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  MobilePhone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  WorkPhone?: string;

  // Par defaut = application.CandidateEmail. A renseigner uniquement pour lever
  // un doublon d'adresse avec un employe existant (Employee.Email @unique).
  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  Email?: string;

  // Enum EN cote Employe (voir CreateEmployeeDto.ContractType). Par defaut
  // deduit cote serveur du modele de contrat puis de l'offre (valeurs FR
  // mappees via RECRUITMENT_TO_EMPLOYEE_CONTRACT_TYPE), sinon 'Permanent'.
  @IsOptional()
  @IsIn([
    'Permanent',
    'FixedTerm',
    'Internship',
    'Freelance',
    'Apprenticeship',
    'WorkStudy',
  ])
  ContractType?: string;

  // Entite reelle : mapping du texte libre RecruitmentContract.EntityName vers
  // une vraie OrganizationUnit (choix explicite dans la modale).
  @IsUUID()
  OrganizationUnitId: string;

  @IsOptional()
  @IsUUID()
  PositionId?: string;

  @IsOptional()
  @IsUUID()
  EmployeeCategoryId?: string;

  // Regime de conges (voir Employee.IsExpatriate). Defaut false.
  @IsOptional()
  @IsBoolean()
  IsExpatriate?: boolean;

  // Suggestion de matricule ; genere cote serveur (EMPnnn) si omis.
  @IsOptional()
  @IsString()
  @MaxLength(20)
  EmployeeNumber?: string;

  // Validateur direct de conges, pour une entite en mode "validateur direct
  // par employe" (le formulaire propose le responsable de l'entite par
  // defaut). Meme controle d'eligibilite que la creation d'un employe
  // (EmployeeService.assertValidDirectValidator : compte actif + CONGE_VALIDER).
  @IsOptional()
  @IsUUID()
  DirectValidatorId?: string;
}

// Corps de POST /recruitment/trial-employees/:id/convert : tous les champs
// optionnels. Corps vide {} = cas courant (l'employe existe deja, on le fait
// juste passer de "En periode d'essai" a "Actif"). Corps complet (Gender +
// BirthDate + MaritalStatus + IdType + OrganizationUnitId au minimum) =
// creation du profil employe au moment de la confirmation de la periode.
export class ConfirmTrialDto extends PartialType(ConvertContractToEmployeeDto) {}
