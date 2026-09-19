-- Requis par la creation de l index filtre plus bas : ces options sont
-- prises en compte a l analyse du lot, d ou le GO qui suit.
SET QUOTED_IDENTIFIER ON;
SET ANSI_NULLS ON;
GO
BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'dbo') EXEC sp_executesql N'CREATE SCHEMA [dbo];';

-- CreateTable
CREATE TABLE [dbo].[OrganizationUnit] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [Code] NVARCHAR(20) NOT NULL,
    [Name] NVARCHAR(150) NOT NULL,
    [Type] NVARCHAR(20) NOT NULL,
    [LegalIdentifier] NVARCHAR(50),
    [ParentId] UNIQUEIDENTIFIER,
    [ManagerId] UNIQUEIDENTIFIER,
    [Address] NVARCHAR(255),
    [Phone] NVARCHAR(30),
    [Email] NVARCHAR(150),
    [Status] NVARCHAR(20) NOT NULL,
    [LeaveApprovalMode] NVARCHAR(20) NOT NULL CONSTRAINT [OrganizationUnit_LeaveApprovalMode_df] DEFAULT 'Pool',
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [OrganizationUnit_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    [IsDeleted] BIT NOT NULL CONSTRAINT [OrganizationUnit_IsDeleted_df] DEFAULT 0,
    [DeletedBy] UNIQUEIDENTIFIER,
    [DeletedAt] DATETIME2,
    CONSTRAINT [OrganizationUnit_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [OrganizationUnit_Code_key] UNIQUE NONCLUSTERED ([Code])
);

-- CreateTable
CREATE TABLE [dbo].[Job] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [Code] NVARCHAR(20) NOT NULL,
    [Title] NVARCHAR(150) NOT NULL,
    [Description] NVARCHAR(max),
    [IsActive] BIT NOT NULL CONSTRAINT [Job_IsActive_df] DEFAULT 1,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [Job_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    CONSTRAINT [Job_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [Job_Code_key] UNIQUE NONCLUSTERED ([Code])
);

-- CreateTable
CREATE TABLE [dbo].[Position] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [Code] NVARCHAR(20) NOT NULL,
    [Title] NVARCHAR(150) NOT NULL,
    [JobId] UNIQUEIDENTIFIER NOT NULL,
    [OrganizationUnitId] UNIQUEIDENTIFIER,
    [ParentPositionId] UNIQUEIDENTIFIER,
    [Capacity] INT NOT NULL CONSTRAINT [Position_Capacity_df] DEFAULT 1,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [Position_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    CONSTRAINT [Position_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [Position_Code_key] UNIQUE NONCLUSTERED ([Code])
);

-- CreateTable
CREATE TABLE [dbo].[Employee] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [EmployeeNumber] NVARCHAR(20) NOT NULL,
    [FirstName] NVARCHAR(100) NOT NULL,
    [LastName] NVARCHAR(100) NOT NULL,
    [FullName] NVARCHAR(200) NOT NULL,
    [Gender] NVARCHAR(5) NOT NULL,
    [BirthDate] DATE NOT NULL,
    [BirthPlace] NVARCHAR(100),
    [MaritalStatus] NVARCHAR(20) NOT NULL,
    [IdType] NVARCHAR(20) NOT NULL,
    [IdNumber] NVARCHAR(50),
    [MobilePhone] NVARCHAR(30),
    [WorkPhone] NVARCHAR(30),
    [Email] NVARCHAR(150) NOT NULL,
    [ContractType] NVARCHAR(20) NOT NULL,
    [HireDate] DATE NOT NULL,
    [TerminationDate] DATE,
    [PositionId] UNIQUEIDENTIFIER,
    [OrganizationUnitId] UNIQUEIDENTIFIER NOT NULL,
    [EmployeeCategoryId] UNIQUEIDENTIFIER,
    [UserId] UNIQUEIDENTIFIER,
    [Status] NVARCHAR(10) NOT NULL,
    [IsExpatriate] BIT NOT NULL CONSTRAINT [Employee_IsExpatriate_df] DEFAULT 0,
    [IsSystem] BIT NOT NULL CONSTRAINT [Employee_IsSystem_df] DEFAULT 0,
    [DirectValidatorId] UNIQUEIDENTIFIER,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [Employee_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    [IsDeleted] BIT NOT NULL CONSTRAINT [Employee_IsDeleted_df] DEFAULT 0,
    [DeletedBy] UNIQUEIDENTIFIER,
    [DeletedAt] DATETIME2,
    CONSTRAINT [Employee_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [Employee_EmployeeNumber_key] UNIQUE NONCLUSTERED ([EmployeeNumber]),
    CONSTRAINT [Employee_Email_key] UNIQUE NONCLUSTERED ([Email]),
    CONSTRAINT [Employee_UserId_key] UNIQUE NONCLUSTERED ([UserId])
);

-- CreateTable
CREATE TABLE [dbo].[User] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [Username] NVARCHAR(100) NOT NULL,
    [Email] NVARCHAR(150) NOT NULL,
    [PasswordHash] NVARCHAR(500) NOT NULL,
    [IsActive] BIT NOT NULL CONSTRAINT [User_IsActive_df] DEFAULT 1,
    [MustChangePassword] BIT NOT NULL CONSTRAINT [User_MustChangePassword_df] DEFAULT 1,
    [LastLoginAt] DATETIME2,
    [ResetPasswordTokenHash] NVARCHAR(255),
    [ResetPasswordExpiresAt] DATETIME2,
    [EmployeeCategoryId] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [User_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedAt] DATETIME2,
    CONSTRAINT [User_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [User_Username_key] UNIQUE NONCLUSTERED ([Username]),
    CONSTRAINT [User_Email_key] UNIQUE NONCLUSTERED ([Email])
);

-- CreateTable
CREATE TABLE [dbo].[Permission] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [Code] NVARCHAR(100) NOT NULL,
    [Label] NVARCHAR(200) NOT NULL,
    [Module] NVARCHAR(50) NOT NULL,
    CONSTRAINT [Permission_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [Permission_Code_key] UNIQUE NONCLUSTERED ([Code])
);

-- CreateTable
CREATE TABLE [dbo].[CategoryPermission] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [EmployeeCategoryId] UNIQUEIDENTIFIER NOT NULL,
    [PermissionId] UNIQUEIDENTIFIER NOT NULL,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [CategoryPermission_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [CategoryPermission_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [CategoryPermission_EmployeeCategoryId_PermissionId_key] UNIQUE NONCLUSTERED ([EmployeeCategoryId],[PermissionId])
);

-- CreateTable
CREATE TABLE [dbo].[UserPermission] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [UserId] UNIQUEIDENTIFIER NOT NULL,
    [PermissionId] UNIQUEIDENTIFIER NOT NULL,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [UserPermission_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [UserPermission_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [UserPermission_UserId_PermissionId_key] UNIQUE NONCLUSTERED ([UserId],[PermissionId])
);

-- CreateTable
CREATE TABLE [dbo].[ApprovalPool] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [OrganizationUnitId] UNIQUEIDENTIFIER NOT NULL,
    [ObjectType] NVARCHAR(20) NOT NULL,
    [Name] NVARCHAR(150) NOT NULL,
    [IsActive] BIT NOT NULL CONSTRAINT [ApprovalPool_IsActive_df] DEFAULT 1,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [ApprovalPool_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    CONSTRAINT [ApprovalPool_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[ApprovalPoolMember] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [ApprovalPoolId] UNIQUEIDENTIFIER NOT NULL,
    [StepOrder] INT NOT NULL,
    [EmployeeId] UNIQUEIDENTIFIER NOT NULL,
    [InterimEmployeeId] UNIQUEIDENTIFIER,
    [InterimStartDate] DATETIME2,
    [InterimEndDate] DATETIME2,
    [IsMandatory] BIT NOT NULL CONSTRAINT [ApprovalPoolMember_IsMandatory_df] DEFAULT 1,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [ApprovalPoolMember_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ApprovalPoolMember_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[ApprovalDecision] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [EntityType] NVARCHAR(30) NOT NULL,
    [EntityId] UNIQUEIDENTIFIER NOT NULL,
    [ApprovalPoolMemberId] UNIQUEIDENTIFIER,
    [DirectValidatorEmployeeId] UNIQUEIDENTIFIER,
    [ValidatedByEmployeeId] UNIQUEIDENTIFIER NOT NULL,
    [StepOrder] INT NOT NULL,
    [Decision] NVARCHAR(20) NOT NULL,
    [Comment] NVARCHAR(500),
    [DecidedAt] DATETIME2,
    [Token] NVARCHAR(64),
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [ApprovalDecision_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ApprovalDecision_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[CompanySettings] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [CompanyName] NVARCHAR(150) NOT NULL,
    [Currency] NVARCHAR(3) NOT NULL,
    [Timezone] NVARCHAR(50) NOT NULL,
    [DayCountingRule] NVARCHAR(20) NOT NULL,
    [DefaultMonthlyAccrualRate] DECIMAL(5,2) NOT NULL,
    [DefaultCarryOverCap] INT NOT NULL,
    [LeaveAccrualRunDay] INT,
    [LastLeaveAccrualRunAt] DATETIME2,
    [IsOnboarded] BIT NOT NULL CONSTRAINT [CompanySettings_IsOnboarded_df] DEFAULT 0,
    [CalendarConfigScope] NVARCHAR(20),
    [CalendarConfigCategoryId] UNIQUEIDENTIFIER,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    CONSTRAINT [CompanySettings_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[Calendar] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [Name] NVARCHAR(100) NOT NULL,
    [IsDefault] BIT NOT NULL CONSTRAINT [Calendar_IsDefault_df] DEFAULT 0,
    [EmployeeCategoryId] UNIQUEIDENTIFIER,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [Calendar_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    CONSTRAINT [Calendar_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [Calendar_EmployeeCategoryId_key] UNIQUE NONCLUSTERED ([EmployeeCategoryId])
);

-- CreateTable
CREATE TABLE [dbo].[CalendarWorkDay] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [CalendarId] UNIQUEIDENTIFIER NOT NULL,
    [DayOfWeek] NVARCHAR(10) NOT NULL,
    [IsEnabled] BIT NOT NULL CONSTRAINT [CalendarWorkDay_IsEnabled_df] DEFAULT 1,
    [StartTime] TIME,
    [EndTime] TIME,
    [BreakEnabled] BIT NOT NULL CONSTRAINT [CalendarWorkDay_BreakEnabled_df] DEFAULT 0,
    [BreakStartTime] TIME,
    [BreakEndTime] TIME,
    CONSTRAINT [CalendarWorkDay_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [CalendarWorkDay_CalendarId_DayOfWeek_key] UNIQUE NONCLUSTERED ([CalendarId],[DayOfWeek])
);

-- CreateTable
CREATE TABLE [dbo].[Holiday] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [Name] NVARCHAR(150) NOT NULL,
    [Date] DATE NOT NULL,
    [IsRecurring] BIT NOT NULL CONSTRAINT [Holiday_IsRecurring_df] DEFAULT 0,
    [HolidayType] NVARCHAR(10) NOT NULL,
    [OrganizationUnitId] UNIQUEIDENTIFIER,
    [AppliesToGender] NVARCHAR(5),
    [AppliesToExpatriate] BIT,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [Holiday_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Holiday_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[LeaveType] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [Code] NVARCHAR(20) NOT NULL,
    [Name] NVARCHAR(100) NOT NULL,
    [WorkflowType] NVARCHAR(20) NOT NULL,
    [MonthlyAccrual] BIT NOT NULL CONSTRAINT [LeaveType_MonthlyAccrual_df] DEFAULT 0,
    [DaysPerYear] DECIMAL(5,2) NOT NULL,
    [DaysPerMonth] DECIMAL(5,2),
    [DocumentRequired] BIT NOT NULL CONSTRAINT [LeaveType_DocumentRequired_df] DEFAULT 0,
    [DocumentDeadlineDays] INT,
    [CarryOverAllowed] BIT NOT NULL CONSTRAINT [LeaveType_CarryOverAllowed_df] DEFAULT 0,
    [CarryOverCap] INT NOT NULL CONSTRAINT [LeaveType_CarryOverCap_df] DEFAULT 0,
    [MinNoticeDays] INT NOT NULL CONSTRAINT [LeaveType_MinNoticeDays_df] DEFAULT 0,
    [Color] NVARCHAR(20) NOT NULL,
    [IsActive] BIT NOT NULL CONSTRAINT [LeaveType_IsActive_df] DEFAULT 1,
    [IsSystem] BIT NOT NULL CONSTRAINT [LeaveType_IsSystem_df] DEFAULT 0,
    [AppliesToGender] NVARCHAR(5),
    [AppliesToExpatriate] BIT,
    [OrganizationUnitId] UNIQUEIDENTIFIER,
    [CountCalendarDays] BIT NOT NULL CONSTRAINT [LeaveType_CountCalendarDays_df] DEFAULT 0,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [LeaveType_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    CONSTRAINT [LeaveType_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [LeaveType_Code_key] UNIQUE NONCLUSTERED ([Code])
);

-- CreateTable
CREATE TABLE [dbo].[EmployeeLeaveBalance] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [EmployeeId] UNIQUEIDENTIFIER NOT NULL,
    [LeaveTypeId] UNIQUEIDENTIFIER,
    [Balance] DECIMAL(6,2) NOT NULL CONSTRAINT [EmployeeLeaveBalance_Balance_df] DEFAULT 0,
    [ModifiedAt] DATETIME2 NOT NULL CONSTRAINT [EmployeeLeaveBalance_ModifiedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [EmployeeLeaveBalance_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [EmployeeLeaveBalance_EmployeeId_LeaveTypeId_key] UNIQUE NONCLUSTERED ([EmployeeId],[LeaveTypeId])
);

-- CreateTable
CREATE TABLE [dbo].[LeaveTransaction] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [EmployeeId] UNIQUEIDENTIFIER NOT NULL,
    [LeaveTypeId] UNIQUEIDENTIFIER,
    [Type] NVARCHAR(20) NOT NULL,
    [Days] DECIMAL(5,2) NOT NULL,
    [StartDate] DATE NOT NULL,
    [EndDate] DATE NOT NULL,
    [LeaveRequestId] UNIQUEIDENTIFIER,
    [Source] NVARCHAR(20) NOT NULL CONSTRAINT [LeaveTransaction_Source_df] DEFAULT 'System',
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [LeaveTransaction_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [LeaveTransaction_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[LeaveCancellation] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [EmployeeId] UNIQUEIDENTIFIER NOT NULL,
    [LeaveTypeId] UNIQUEIDENTIFIER NOT NULL,
    [Year] INT NOT NULL,
    [DaysCancelled] DECIMAL(5,2) NOT NULL,
    [Reason] NVARCHAR(255) NOT NULL,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [LeaveCancellation_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [LeaveCancellation_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[LeaveRequest] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [ReferenceCode] NVARCHAR(20) NOT NULL,
    [EmployeeId] UNIQUEIDENTIFIER NOT NULL,
    [LeaveTypeId] UNIQUEIDENTIFIER NOT NULL,
    [StartDate] DATE NOT NULL,
    [StartPeriod] NVARCHAR(4) NOT NULL CONSTRAINT [LeaveRequest_StartPeriod_df] DEFAULT 'full',
    [EndDate] DATE NOT NULL,
    [EndPeriod] NVARCHAR(4) NOT NULL CONSTRAINT [LeaveRequest_EndPeriod_df] DEFAULT 'full',
    [DaysCount] DECIMAL(5,2) NOT NULL,
    [Reason] NVARCHAR(500),
    [InterimEmployeeId] UNIQUEIDENTIFIER,
    [Status] NVARCHAR(25) NOT NULL,
    [ApprovalPoolId] UNIQUEIDENTIFIER,
    [CurrentApprovalStep] INT,
    [RejectionReason] NVARCHAR(500),
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [LeaveRequest_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    [IsDeleted] BIT NOT NULL CONSTRAINT [LeaveRequest_IsDeleted_df] DEFAULT 0,
    [DeletedBy] UNIQUEIDENTIFIER,
    [DeletedAt] DATETIME2,
    CONSTRAINT [LeaveRequest_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [LeaveRequest_ReferenceCode_key] UNIQUE NONCLUSTERED ([ReferenceCode])
);

-- CreateTable
CREATE TABLE [dbo].[MissionOrder] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [ReferenceCode] NVARCHAR(20) NOT NULL,
    [EmployeeId] UNIQUEIDENTIFIER NOT NULL,
    [Destination] NVARCHAR(150) NOT NULL,
    [MissionCategory] NVARCHAR(20) NOT NULL,
    [Purpose] NVARCHAR(500) NOT NULL,
    [DepartureDate] DATE NOT NULL,
    [ReturnDate] DATE NOT NULL,
    [DaysCount] DECIMAL(5,2) NOT NULL,
    [TransportModeGo] NVARCHAR(30) NOT NULL,
    [TransportModeReturn] NVARCHAR(30) NOT NULL,
    [AdvanceRequested] DECIMAL(18,2) NOT NULL,
    [Currency] NVARCHAR(3) NOT NULL,
    [Status] NVARCHAR(25) NOT NULL,
    [ApprovalPoolId] UNIQUEIDENTIFIER,
    [CurrentApprovalStep] INT,
    [RejectionReason] NVARCHAR(500),
    [LinkedMissionOrderId] UNIQUEIDENTIFIER,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [MissionOrder_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    [IsDeleted] BIT NOT NULL CONSTRAINT [MissionOrder_IsDeleted_df] DEFAULT 0,
    [DeletedBy] UNIQUEIDENTIFIER,
    [DeletedAt] DATETIME2,
    CONSTRAINT [MissionOrder_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [MissionOrder_ReferenceCode_key] UNIQUE NONCLUSTERED ([ReferenceCode])
);

-- CreateTable
CREATE TABLE [dbo].[MissionExpenseLine] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [MissionOrderId] UNIQUEIDENTIFIER NOT NULL,
    [ExpenseTypeId] UNIQUEIDENTIFIER NOT NULL,
    [Description] NVARCHAR(255),
    [Amount] DECIMAL(18,2) NOT NULL,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [MissionExpenseLine_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [MissionExpenseLine_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[ExpenseReport] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [ReferenceCode] NVARCHAR(20) NOT NULL,
    [MissionOrderId] UNIQUEIDENTIFIER,
    [EmployeeId] UNIQUEIDENTIFIER NOT NULL,
    [Title] NVARCHAR(150) NOT NULL,
    [Currency] NVARCHAR(3) NOT NULL,
    [Status] NVARCHAR(20) NOT NULL,
    [ApprovalPoolId] UNIQUEIDENTIFIER,
    [CurrentApprovalStep] INT,
    [RejectionReason] NVARCHAR(500),
    [SubmittedAt] DATETIME2,
    [ReimbursedAt] DATETIME2,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [ExpenseReport_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    [IsDeleted] BIT NOT NULL CONSTRAINT [ExpenseReport_IsDeleted_df] DEFAULT 0,
    [DeletedBy] UNIQUEIDENTIFIER,
    [DeletedAt] DATETIME2,
    CONSTRAINT [ExpenseReport_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [ExpenseReport_ReferenceCode_key] UNIQUE NONCLUSTERED ([ReferenceCode])
);

-- CreateTable
CREATE TABLE [dbo].[ExpenseLine] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [ExpenseReportId] UNIQUEIDENTIFIER NOT NULL,
    [ExpenseDate] DATE NOT NULL,
    [ExpenseTypeId] UNIQUEIDENTIFIER NOT NULL,
    [Description] NVARCHAR(255),
    [Amount] DECIMAL(18,2) NOT NULL,
    [Currency] NVARCHAR(3) NOT NULL,
    [HasDocument] BIT NOT NULL CONSTRAINT [ExpenseLine_HasDocument_df] DEFAULT 0,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [ExpenseLine_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    CONSTRAINT [ExpenseLine_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[EmployeeCategory] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [Code] NVARCHAR(20) NOT NULL,
    [Name] NVARCHAR(100) NOT NULL,
    [Description] NVARCHAR(255),
    [IsActive] BIT NOT NULL CONSTRAINT [EmployeeCategory_IsActive_df] DEFAULT 1,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [EmployeeCategory_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    CONSTRAINT [EmployeeCategory_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [EmployeeCategory_Code_key] UNIQUE NONCLUSTERED ([Code])
);

-- CreateTable
CREATE TABLE [dbo].[ExpenseType] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [Code] NVARCHAR(20) NOT NULL,
    [Name] NVARCHAR(100) NOT NULL,
    [Unit] NVARCHAR(20) NOT NULL,
    [IsActive] BIT NOT NULL CONSTRAINT [ExpenseType_IsActive_df] DEFAULT 1,
    [IsSystem] BIT NOT NULL CONSTRAINT [ExpenseType_IsSystem_df] DEFAULT 0,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [ExpenseType_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    CONSTRAINT [ExpenseType_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [ExpenseType_Code_key] UNIQUE NONCLUSTERED ([Code])
);

-- CreateTable
CREATE TABLE [dbo].[ExpenseConfig] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [EmployeeCategoryId] UNIQUEIDENTIFIER NOT NULL,
    [ExpenseTypeId] UNIQUEIDENTIFIER NOT NULL,
    [MissionCategory] NVARCHAR(20) NOT NULL,
    [DailyRate] DECIMAL(18,2) NOT NULL,
    [Currency] NVARCHAR(3) NOT NULL,
    [DocumentRequired] BIT NOT NULL CONSTRAINT [ExpenseConfig_DocumentRequired_df] DEFAULT 0,
    [IsActive] BIT NOT NULL CONSTRAINT [ExpenseConfig_IsActive_df] DEFAULT 1,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [ExpenseConfig_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    CONSTRAINT [ExpenseConfig_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [ExpenseConfig_EmployeeCategoryId_ExpenseTypeId_MissionCategory_key] UNIQUE NONCLUSTERED ([EmployeeCategoryId],[ExpenseTypeId],[MissionCategory])
);

-- CreateTable
CREATE TABLE [dbo].[ExpenseCeiling] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [EmployeeCategoryId] UNIQUEIDENTIFIER NOT NULL,
    [ExpenseTypeId] UNIQUEIDENTIFIER NOT NULL,
    [MaxAmount] DECIMAL(18,2) NOT NULL,
    [Currency] NVARCHAR(3) NOT NULL,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [ExpenseCeiling_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    CONSTRAINT [ExpenseCeiling_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [ExpenseCeiling_EmployeeCategoryId_ExpenseTypeId_key] UNIQUE NONCLUSTERED ([EmployeeCategoryId],[ExpenseTypeId])
);

-- CreateTable
CREATE TABLE [dbo].[Attachment] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [EntityType] NVARCHAR(30) NOT NULL,
    [EntityId] UNIQUEIDENTIFIER NOT NULL,
    [FileName] NVARCHAR(255) NOT NULL,
    [FileUrl] NVARCHAR(500) NOT NULL,
    [FileSize] INT NOT NULL,
    [MimeType] NVARCHAR(100) NOT NULL,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [Attachment_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Attachment_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[Notification] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [EmployeeId] UNIQUEIDENTIFIER NOT NULL,
    [Type] NVARCHAR(20) NOT NULL,
    [Title] NVARCHAR(150) NOT NULL,
    [Message] NVARCHAR(500) NOT NULL,
    [Href] NVARCHAR(200),
    [IsRead] BIT NOT NULL CONSTRAINT [Notification_IsRead_df] DEFAULT 0,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [Notification_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Notification_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[HiringRequest] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [ReferenceCode] NVARCHAR(20) NOT NULL,
    [PositionTitle] NVARCHAR(150) NOT NULL,
    [EntityName] NVARCHAR(150) NOT NULL,
    [Headcount] INT NOT NULL CONSTRAINT [HiringRequest_Headcount_df] DEFAULT 1,
    [Profile] NVARCHAR(max) NOT NULL,
    [PositionId] UNIQUEIDENTIFIER,
    [Status] NVARCHAR(20) NOT NULL CONSTRAINT [HiringRequest_Status_df] DEFAULT 'Draft',
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [HiringRequest_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    [IsDeleted] BIT NOT NULL CONSTRAINT [HiringRequest_IsDeleted_df] DEFAULT 0,
    [DeletedBy] UNIQUEIDENTIFIER,
    [DeletedAt] DATETIME2,
    CONSTRAINT [HiringRequest_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [HiringRequest_ReferenceCode_key] UNIQUE NONCLUSTERED ([ReferenceCode])
);

-- CreateTable
CREATE TABLE [dbo].[JobOffer] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [ReferenceCode] NVARCHAR(20) NOT NULL,
    [HiringRequestId] UNIQUEIDENTIFIER,
    [Title] NVARCHAR(150) NOT NULL,
    [EntityName] NVARCHAR(150) NOT NULL,
    [ContractType] NVARCHAR(30) NOT NULL,
    [Location] NVARCHAR(150) NOT NULL,
    [Description] NVARCHAR(max) NOT NULL,
    [Status] NVARCHAR(20) NOT NULL CONSTRAINT [JobOffer_Status_df] DEFAULT 'Draft',
    [PublishedAt] DATETIME2,
    [Views] INT NOT NULL CONSTRAINT [JobOffer_Views_df] DEFAULT 0,
    [ExcludeFromFeed] BIT NOT NULL CONSTRAINT [JobOffer_ExcludeFromFeed_df] DEFAULT 0,
    [SalaryText] NVARCHAR(120),
    [RecruitmentCost] DECIMAL(18,2),
    [InterviewEvaluationTemplateId] UNIQUEIDENTIFIER,
    [PublicToken] NVARCHAR(64) NOT NULL,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [JobOffer_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    [IsDeleted] BIT NOT NULL CONSTRAINT [JobOffer_IsDeleted_df] DEFAULT 0,
    [DeletedBy] UNIQUEIDENTIFIER,
    [DeletedAt] DATETIME2,
    CONSTRAINT [JobOffer_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [JobOffer_ReferenceCode_key] UNIQUE NONCLUSTERED ([ReferenceCode])
);

-- CreateTable
CREATE TABLE [dbo].[InterviewEvaluationTemplate] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [Name] NVARCHAR(150) NOT NULL,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [InterviewEvaluationTemplate_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    [IsDeleted] BIT NOT NULL CONSTRAINT [InterviewEvaluationTemplate_IsDeleted_df] DEFAULT 0,
    [DeletedBy] UNIQUEIDENTIFIER,
    [DeletedAt] DATETIME2,
    CONSTRAINT [InterviewEvaluationTemplate_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[InterviewEvaluationCriterion] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [TemplateId] UNIQUEIDENTIFIER NOT NULL,
    [Label] NVARCHAR(200) NOT NULL,
    [Position] INT NOT NULL CONSTRAINT [InterviewEvaluationCriterion_Position_df] DEFAULT 0,
    CONSTRAINT [InterviewEvaluationCriterion_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[RecruitmentApplication] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [ReferenceCode] NVARCHAR(20) NOT NULL,
    [JobOfferId] UNIQUEIDENTIFIER,
    [JobOfferTitle] NVARCHAR(150),
    [CandidateName] NVARCHAR(150) NOT NULL,
    [CandidateEmail] NVARCHAR(150) NOT NULL,
    [CandidatePhone] NVARCHAR(30) NOT NULL,
    [Source] NVARCHAR(20) NOT NULL,
    [CvFileName] NVARCHAR(255),
    [EmployeeId] UNIQUEIDENTIFIER,
    [Status] NVARCHAR(20) NOT NULL CONSTRAINT [RecruitmentApplication_Status_df] DEFAULT 'New',
    [AppliedAt] DATETIME2 NOT NULL,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [RecruitmentApplication_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    [IsDeleted] BIT NOT NULL CONSTRAINT [RecruitmentApplication_IsDeleted_df] DEFAULT 0,
    [DeletedBy] UNIQUEIDENTIFIER,
    [DeletedAt] DATETIME2,
    CONSTRAINT [RecruitmentApplication_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [RecruitmentApplication_ReferenceCode_key] UNIQUE NONCLUSTERED ([ReferenceCode])
);

-- CreateTable
CREATE TABLE [dbo].[ApplicationNote] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [ApplicationId] UNIQUEIDENTIFIER NOT NULL,
    [AuthorName] NVARCHAR(150) NOT NULL,
    [Text] NVARCHAR(max) NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [ApplicationNote_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ApplicationNote_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[Interview] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [ReferenceCode] NVARCHAR(20) NOT NULL,
    [ApplicationId] UNIQUEIDENTIFIER NOT NULL,
    [ScheduledAt] DATETIME2 NOT NULL,
    [Mode] NVARCHAR(20) NOT NULL,
    [Location] NVARCHAR(255),
    [MeetingLink] NVARCHAR(500),
    [Status] NVARCHAR(20) NOT NULL CONSTRAINT [Interview_Status_df] DEFAULT 'Scheduled',
    [CandidateRsvp] NVARCHAR(20) NOT NULL CONSTRAINT [Interview_CandidateRsvp_df] DEFAULT 'Pending',
    [CandidateRsvpToken] NVARCHAR(64),
    [CandidateRsvpAt] DATETIME2,
    [CandidateRsvpSource] NVARCHAR(20),
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [Interview_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    [IsDeleted] BIT NOT NULL CONSTRAINT [Interview_IsDeleted_df] DEFAULT 0,
    [DeletedBy] UNIQUEIDENTIFIER,
    [DeletedAt] DATETIME2,
    CONSTRAINT [Interview_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [Interview_ReferenceCode_key] UNIQUE NONCLUSTERED ([ReferenceCode])
);

-- CreateTable
CREATE TABLE [dbo].[InterviewParticipant] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [InterviewId] UNIQUEIDENTIFIER NOT NULL,
    [EmployeeId] UNIQUEIDENTIFIER,
    [Name] NVARCHAR(150) NOT NULL,
    [Email] NVARCHAR(150),
    [Rsvp] NVARCHAR(20) NOT NULL CONSTRAINT [InterviewParticipant_Rsvp_df] DEFAULT 'Pending',
    [RsvpToken] NVARCHAR(64),
    [RsvpAt] DATETIME2,
    [RsvpSource] NVARCHAR(20),
    CONSTRAINT [InterviewParticipant_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[InterviewEvaluation] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [InterviewId] UNIQUEIDENTIFIER NOT NULL,
    [Score] DECIMAL(4,2) NOT NULL,
    [Comment] NVARCHAR(max) NOT NULL,
    [InterviewerName] NVARCHAR(150) NOT NULL,
    [TemplateName] NVARCHAR(150),
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [InterviewEvaluation_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [InterviewEvaluation_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [InterviewEvaluation_InterviewId_key] UNIQUE NONCLUSTERED ([InterviewId])
);

-- CreateTable
CREATE TABLE [dbo].[InterviewCriterionScore] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [EvaluationId] UNIQUEIDENTIFIER NOT NULL,
    [Label] NVARCHAR(200) NOT NULL,
    [Score] INT NOT NULL,
    CONSTRAINT [InterviewCriterionScore_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[RecruitmentContract] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [ReferenceCode] NVARCHAR(20) NOT NULL,
    [ApplicationId] UNIQUEIDENTIFIER NOT NULL,
    [TemplateId] UNIQUEIDENTIFIER,
    [TemplateName] NVARCHAR(150),
    [CandidateName] NVARCHAR(150) NOT NULL,
    [JobTitle] NVARCHAR(150) NOT NULL,
    [EntityName] NVARCHAR(150) NOT NULL,
    [StartDate] DATE NOT NULL,
    [EndDate] DATE,
    [Salary] DECIMAL(18,2) NOT NULL,
    [Status] NVARCHAR(20) NOT NULL CONSTRAINT [RecruitmentContract_Status_df] DEFAULT 'Draft',
    [RejectionReason] NVARCHAR(500),
    [EmployeeProfileCreated] BIT NOT NULL CONSTRAINT [RecruitmentContract_EmployeeProfileCreated_df] DEFAULT 0,
    [CreatedEmployeeId] UNIQUEIDENTIFIER,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [RecruitmentContract_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    [IsDeleted] BIT NOT NULL CONSTRAINT [RecruitmentContract_IsDeleted_df] DEFAULT 0,
    [DeletedBy] UNIQUEIDENTIFIER,
    [DeletedAt] DATETIME2,
    CONSTRAINT [RecruitmentContract_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [RecruitmentContract_ReferenceCode_key] UNIQUE NONCLUSTERED ([ReferenceCode]),
    CONSTRAINT [RecruitmentContract_ApplicationId_key] UNIQUE NONCLUSTERED ([ApplicationId])
);

-- CreateTable
CREATE TABLE [dbo].[ContractNegotiationRound] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [ContractId] UNIQUEIDENTIFIER NOT NULL,
    [RoundNo] INT NOT NULL,
    [FromParty] NVARCHAR(20) NOT NULL,
    [Amount] DECIMAL(18,2),
    [Comment] NVARCHAR(max) NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [ContractNegotiationRound_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ContractNegotiationRound_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[ContractTemplate] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [Name] NVARCHAR(150) NOT NULL,
    [ContractType] NVARCHAR(30) NOT NULL,
    [Content] NVARCHAR(max) NOT NULL,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [ContractTemplate_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    [IsDeleted] BIT NOT NULL CONSTRAINT [ContractTemplate_IsDeleted_df] DEFAULT 0,
    [DeletedBy] UNIQUEIDENTIFIER,
    [DeletedAt] DATETIME2,
    CONSTRAINT [ContractTemplate_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[TrialEmployee] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [ReferenceCode] NVARCHAR(20) NOT NULL,
    [ContractId] UNIQUEIDENTIFIER NOT NULL,
    [EmployeeName] NVARCHAR(150) NOT NULL,
    [JobTitle] NVARCHAR(150) NOT NULL,
    [EntityName] NVARCHAR(150) NOT NULL,
    [StartDate] DATE NOT NULL,
    [TrialEndDate] DATE NOT NULL,
    [Status] NVARCHAR(20) NOT NULL CONSTRAINT [TrialEmployee_Status_df] DEFAULT 'OnTrial',
    [EvalScore] INT,
    [EvalComment] NVARCHAR(max),
    [EvalByName] NVARCHAR(150),
    [EvalAt] DATETIME2,
    [CreatedEmployeeId] UNIQUEIDENTIFIER,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [TrialEmployee_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    [IsDeleted] BIT NOT NULL CONSTRAINT [TrialEmployee_IsDeleted_df] DEFAULT 0,
    [DeletedBy] UNIQUEIDENTIFIER,
    [DeletedAt] DATETIME2,
    CONSTRAINT [TrialEmployee_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [TrialEmployee_ReferenceCode_key] UNIQUE NONCLUSTERED ([ReferenceCode]),
    CONSTRAINT [TrialEmployee_ContractId_key] UNIQUE NONCLUSTERED ([ContractId])
);

-- CreateTable
CREATE TABLE [dbo].[TalentPoolEntry] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [ReferenceCode] NVARCHAR(20) NOT NULL,
    [CandidateName] NVARCHAR(150) NOT NULL,
    [CandidateEmail] NVARCHAR(150) NOT NULL,
    [CandidatePhone] NVARCHAR(30) NOT NULL,
    [Tags] NVARCHAR(500) NOT NULL CONSTRAINT [TalentPoolEntry_Tags_df] DEFAULT '',
    [Notes] NVARCHAR(max) NOT NULL,
    [SourceApplicationId] UNIQUEIDENTIFIER,
    [AddedAt] DATETIME2 NOT NULL,
    [Status] NVARCHAR(20) NOT NULL CONSTRAINT [TalentPoolEntry_Status_df] DEFAULT 'Open',
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [TalentPoolEntry_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    [IsDeleted] BIT NOT NULL CONSTRAINT [TalentPoolEntry_IsDeleted_df] DEFAULT 0,
    [DeletedBy] UNIQUEIDENTIFIER,
    [DeletedAt] DATETIME2,
    CONSTRAINT [TalentPoolEntry_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [TalentPoolEntry_ReferenceCode_key] UNIQUE NONCLUSTERED ([ReferenceCode])
);

-- CreateTable
CREATE TABLE [dbo].[TalentPoolEvaluation] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [TalentPoolEntryId] UNIQUEIDENTIFIER NOT NULL,
    [Score] INT NOT NULL,
    [Comment] NVARCHAR(max) NOT NULL,
    [EvaluatedByName] NVARCHAR(150) NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [TalentPoolEvaluation_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [TalentPoolEvaluation_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[DistributionChannel] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [Name] NVARCHAR(120) NOT NULL,
    [Kind] NVARCHAR(20) NOT NULL,
    [TargetUrl] NVARCHAR(500),
    [TargetEmail] NVARCHAR(150),
    [Secret] NVARCHAR(200),
    [IsActive] BIT NOT NULL CONSTRAINT [DistributionChannel_IsActive_df] DEFAULT 1,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [DistributionChannel_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    [IsDeleted] BIT NOT NULL CONSTRAINT [DistributionChannel_IsDeleted_df] DEFAULT 0,
    [DeletedBy] UNIQUEIDENTIFIER,
    [DeletedAt] DATETIME2,
    CONSTRAINT [DistributionChannel_pkey] PRIMARY KEY CLUSTERED ([Id])
);

-- CreateTable
CREATE TABLE [dbo].[JobOfferDistribution] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [JobOfferId] UNIQUEIDENTIFIER NOT NULL,
    [ChannelId] UNIQUEIDENTIFIER NOT NULL,
    [ChannelName] NVARCHAR(120) NOT NULL,
    [ChannelKind] NVARCHAR(20) NOT NULL,
    [Status] NVARCHAR(20) NOT NULL CONSTRAINT [JobOfferDistribution_Status_df] DEFAULT 'Pending',
    [Trigger] NVARCHAR(20) NOT NULL,
    [ExternalUrl] NVARCHAR(500),
    [Attempts] INT NOT NULL CONSTRAINT [JobOfferDistribution_Attempts_df] DEFAULT 0,
    [HttpStatus] INT,
    [ResponseSnippet] NVARCHAR(500),
    [LastAttemptAt] DATETIME2,
    [PostedAt] DATETIME2,
    [CreatedBy] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [JobOfferDistribution_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    [ModifiedBy] UNIQUEIDENTIFIER,
    [ModifiedAt] DATETIME2,
    CONSTRAINT [JobOfferDistribution_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [JobOfferDistribution_JobOfferId_ChannelId_key] UNIQUE NONCLUSTERED ([JobOfferId],[ChannelId])
);

-- CreateTable
CREATE TABLE [dbo].[ReminderDispatchLog] (
    [Id] UNIQUEIDENTIFIER NOT NULL,
    [DedupKey] NVARCHAR(64) NOT NULL,
    [Category] NVARCHAR(30) NOT NULL,
    [EntityType] NVARCHAR(30) NOT NULL,
    [EntityId] UNIQUEIDENTIFIER NOT NULL,
    [DueDate] DATE NOT NULL,
    [LeadBucket] INT NOT NULL,
    [RecipientEmployeeId] UNIQUEIDENTIFIER NOT NULL,
    [CreatedAt] DATETIME2 NOT NULL CONSTRAINT [ReminderDispatchLog_CreatedAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [ReminderDispatchLog_pkey] PRIMARY KEY CLUSTERED ([Id]),
    CONSTRAINT [ReminderDispatchLog_DedupKey_key] UNIQUE NONCLUSTERED ([DedupKey])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [OrganizationUnit_ParentId_idx] ON [dbo].[OrganizationUnit]([ParentId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [OrganizationUnit_ManagerId_idx] ON [dbo].[OrganizationUnit]([ManagerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Position_JobId_idx] ON [dbo].[Position]([JobId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Position_OrganizationUnitId_idx] ON [dbo].[Position]([OrganizationUnitId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Position_ParentPositionId_idx] ON [dbo].[Position]([ParentPositionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Employee_PositionId_idx] ON [dbo].[Employee]([PositionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Employee_OrganizationUnitId_idx] ON [dbo].[Employee]([OrganizationUnitId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Employee_EmployeeCategoryId_idx] ON [dbo].[Employee]([EmployeeCategoryId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Employee_DirectValidatorId_idx] ON [dbo].[Employee]([DirectValidatorId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Employee_ContractType_TerminationDate_idx] ON [dbo].[Employee]([ContractType], [TerminationDate]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [User_EmployeeCategoryId_idx] ON [dbo].[User]([EmployeeCategoryId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CategoryPermission_PermissionId_idx] ON [dbo].[CategoryPermission]([PermissionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UserPermission_PermissionId_idx] ON [dbo].[UserPermission]([PermissionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [UserPermission_CreatedBy_idx] ON [dbo].[UserPermission]([CreatedBy]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ApprovalPool_OrganizationUnitId_idx] ON [dbo].[ApprovalPool]([OrganizationUnitId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ApprovalPoolMember_ApprovalPoolId_idx] ON [dbo].[ApprovalPoolMember]([ApprovalPoolId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ApprovalPoolMember_EmployeeId_idx] ON [dbo].[ApprovalPoolMember]([EmployeeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ApprovalPoolMember_InterimEmployeeId_idx] ON [dbo].[ApprovalPoolMember]([InterimEmployeeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ApprovalDecision_EntityType_EntityId_idx] ON [dbo].[ApprovalDecision]([EntityType], [EntityId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ApprovalDecision_ApprovalPoolMemberId_idx] ON [dbo].[ApprovalDecision]([ApprovalPoolMemberId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ApprovalDecision_DirectValidatorEmployeeId_idx] ON [dbo].[ApprovalDecision]([DirectValidatorEmployeeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ApprovalDecision_ValidatedByEmployeeId_idx] ON [dbo].[ApprovalDecision]([ValidatedByEmployeeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ApprovalDecision_Token_idx] ON [dbo].[ApprovalDecision]([Token]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Holiday_OrganizationUnitId_idx] ON [dbo].[Holiday]([OrganizationUnitId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LeaveType_OrganizationUnitId_idx] ON [dbo].[LeaveType]([OrganizationUnitId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EmployeeLeaveBalance_EmployeeId_idx] ON [dbo].[EmployeeLeaveBalance]([EmployeeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EmployeeLeaveBalance_LeaveTypeId_idx] ON [dbo].[EmployeeLeaveBalance]([LeaveTypeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LeaveTransaction_EmployeeId_idx] ON [dbo].[LeaveTransaction]([EmployeeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LeaveTransaction_LeaveTypeId_idx] ON [dbo].[LeaveTransaction]([LeaveTypeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LeaveTransaction_LeaveRequestId_idx] ON [dbo].[LeaveTransaction]([LeaveRequestId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LeaveCancellation_EmployeeId_idx] ON [dbo].[LeaveCancellation]([EmployeeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LeaveCancellation_LeaveTypeId_idx] ON [dbo].[LeaveCancellation]([LeaveTypeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LeaveRequest_EmployeeId_idx] ON [dbo].[LeaveRequest]([EmployeeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LeaveRequest_LeaveTypeId_idx] ON [dbo].[LeaveRequest]([LeaveTypeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [LeaveRequest_ApprovalPoolId_idx] ON [dbo].[LeaveRequest]([ApprovalPoolId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MissionOrder_EmployeeId_idx] ON [dbo].[MissionOrder]([EmployeeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MissionOrder_ApprovalPoolId_idx] ON [dbo].[MissionOrder]([ApprovalPoolId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MissionOrder_LinkedMissionOrderId_idx] ON [dbo].[MissionOrder]([LinkedMissionOrderId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MissionExpenseLine_MissionOrderId_idx] ON [dbo].[MissionExpenseLine]([MissionOrderId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MissionExpenseLine_ExpenseTypeId_idx] ON [dbo].[MissionExpenseLine]([ExpenseTypeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ExpenseReport_MissionOrderId_idx] ON [dbo].[ExpenseReport]([MissionOrderId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ExpenseReport_EmployeeId_idx] ON [dbo].[ExpenseReport]([EmployeeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ExpenseReport_ApprovalPoolId_idx] ON [dbo].[ExpenseReport]([ApprovalPoolId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ExpenseLine_ExpenseReportId_idx] ON [dbo].[ExpenseLine]([ExpenseReportId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ExpenseLine_ExpenseTypeId_idx] ON [dbo].[ExpenseLine]([ExpenseTypeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ExpenseConfig_ExpenseTypeId_idx] ON [dbo].[ExpenseConfig]([ExpenseTypeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ExpenseCeiling_ExpenseTypeId_idx] ON [dbo].[ExpenseCeiling]([ExpenseTypeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Attachment_EntityType_EntityId_idx] ON [dbo].[Attachment]([EntityType], [EntityId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Notification_EmployeeId_idx] ON [dbo].[Notification]([EmployeeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [HiringRequest_Status_idx] ON [dbo].[HiringRequest]([Status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [HiringRequest_CreatedBy_idx] ON [dbo].[HiringRequest]([CreatedBy]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [HiringRequest_PositionId_idx] ON [dbo].[HiringRequest]([PositionId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [JobOffer_HiringRequestId_idx] ON [dbo].[JobOffer]([HiringRequestId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [JobOffer_InterviewEvaluationTemplateId_idx] ON [dbo].[JobOffer]([InterviewEvaluationTemplateId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [JobOffer_Status_idx] ON [dbo].[JobOffer]([Status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [JobOffer_PublicToken_idx] ON [dbo].[JobOffer]([PublicToken]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [JobOffer_CreatedBy_idx] ON [dbo].[JobOffer]([CreatedBy]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [InterviewEvaluationTemplate_CreatedBy_idx] ON [dbo].[InterviewEvaluationTemplate]([CreatedBy]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [InterviewEvaluationCriterion_TemplateId_idx] ON [dbo].[InterviewEvaluationCriterion]([TemplateId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RecruitmentApplication_JobOfferId_idx] ON [dbo].[RecruitmentApplication]([JobOfferId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RecruitmentApplication_EmployeeId_idx] ON [dbo].[RecruitmentApplication]([EmployeeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RecruitmentApplication_Status_idx] ON [dbo].[RecruitmentApplication]([Status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RecruitmentApplication_CreatedBy_idx] ON [dbo].[RecruitmentApplication]([CreatedBy]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ApplicationNote_ApplicationId_idx] ON [dbo].[ApplicationNote]([ApplicationId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Interview_ApplicationId_idx] ON [dbo].[Interview]([ApplicationId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Interview_Status_idx] ON [dbo].[Interview]([Status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Interview_CandidateRsvpToken_idx] ON [dbo].[Interview]([CandidateRsvpToken]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [InterviewParticipant_InterviewId_idx] ON [dbo].[InterviewParticipant]([InterviewId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [InterviewParticipant_EmployeeId_idx] ON [dbo].[InterviewParticipant]([EmployeeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [InterviewParticipant_RsvpToken_idx] ON [dbo].[InterviewParticipant]([RsvpToken]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [InterviewCriterionScore_EvaluationId_idx] ON [dbo].[InterviewCriterionScore]([EvaluationId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RecruitmentContract_TemplateId_idx] ON [dbo].[RecruitmentContract]([TemplateId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RecruitmentContract_Status_idx] ON [dbo].[RecruitmentContract]([Status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RecruitmentContract_CreatedBy_idx] ON [dbo].[RecruitmentContract]([CreatedBy]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RecruitmentContract_CreatedEmployeeId_idx] ON [dbo].[RecruitmentContract]([CreatedEmployeeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ContractNegotiationRound_ContractId_idx] ON [dbo].[ContractNegotiationRound]([ContractId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ContractTemplate_CreatedBy_idx] ON [dbo].[ContractTemplate]([CreatedBy]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TrialEmployee_Status_idx] ON [dbo].[TrialEmployee]([Status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TrialEmployee_CreatedBy_idx] ON [dbo].[TrialEmployee]([CreatedBy]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TrialEmployee_CreatedEmployeeId_idx] ON [dbo].[TrialEmployee]([CreatedEmployeeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TalentPoolEntry_Status_idx] ON [dbo].[TalentPoolEntry]([Status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TalentPoolEntry_CreatedBy_idx] ON [dbo].[TalentPoolEntry]([CreatedBy]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TalentPoolEvaluation_TalentPoolEntryId_idx] ON [dbo].[TalentPoolEvaluation]([TalentPoolEntryId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DistributionChannel_Kind_idx] ON [dbo].[DistributionChannel]([Kind]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DistributionChannel_IsActive_idx] ON [dbo].[DistributionChannel]([IsActive]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DistributionChannel_CreatedBy_idx] ON [dbo].[DistributionChannel]([CreatedBy]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [JobOfferDistribution_JobOfferId_idx] ON [dbo].[JobOfferDistribution]([JobOfferId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [JobOfferDistribution_ChannelId_idx] ON [dbo].[JobOfferDistribution]([ChannelId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [JobOfferDistribution_Status_idx] ON [dbo].[JobOfferDistribution]([Status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [JobOfferDistribution_CreatedBy_idx] ON [dbo].[JobOfferDistribution]([CreatedBy]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ReminderDispatchLog_RecipientEmployeeId_idx] ON [dbo].[ReminderDispatchLog]([RecipientEmployeeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ReminderDispatchLog_DueDate_idx] ON [dbo].[ReminderDispatchLog]([DueDate]);

-- AddForeignKey
ALTER TABLE [dbo].[OrganizationUnit] ADD CONSTRAINT [OrganizationUnit_ParentId_fkey] FOREIGN KEY ([ParentId]) REFERENCES [dbo].[OrganizationUnit]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[OrganizationUnit] ADD CONSTRAINT [OrganizationUnit_ManagerId_fkey] FOREIGN KEY ([ManagerId]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[OrganizationUnit] ADD CONSTRAINT [OrganizationUnit_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[OrganizationUnit] ADD CONSTRAINT [OrganizationUnit_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Job] ADD CONSTRAINT [Job_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Job] ADD CONSTRAINT [Job_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Position] ADD CONSTRAINT [Position_JobId_fkey] FOREIGN KEY ([JobId]) REFERENCES [dbo].[Job]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Position] ADD CONSTRAINT [Position_OrganizationUnitId_fkey] FOREIGN KEY ([OrganizationUnitId]) REFERENCES [dbo].[OrganizationUnit]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Position] ADD CONSTRAINT [Position_ParentPositionId_fkey] FOREIGN KEY ([ParentPositionId]) REFERENCES [dbo].[Position]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Position] ADD CONSTRAINT [Position_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Position] ADD CONSTRAINT [Position_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Employee] ADD CONSTRAINT [Employee_PositionId_fkey] FOREIGN KEY ([PositionId]) REFERENCES [dbo].[Position]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Employee] ADD CONSTRAINT [Employee_OrganizationUnitId_fkey] FOREIGN KEY ([OrganizationUnitId]) REFERENCES [dbo].[OrganizationUnit]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Employee] ADD CONSTRAINT [Employee_DirectValidatorId_fkey] FOREIGN KEY ([DirectValidatorId]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Employee] ADD CONSTRAINT [Employee_UserId_fkey] FOREIGN KEY ([UserId]) REFERENCES [dbo].[User]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Employee] ADD CONSTRAINT [Employee_EmployeeCategoryId_fkey] FOREIGN KEY ([EmployeeCategoryId]) REFERENCES [dbo].[EmployeeCategory]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Employee] ADD CONSTRAINT [Employee_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Employee] ADD CONSTRAINT [Employee_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[User] ADD CONSTRAINT [User_EmployeeCategoryId_fkey] FOREIGN KEY ([EmployeeCategoryId]) REFERENCES [dbo].[EmployeeCategory]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CategoryPermission] ADD CONSTRAINT [CategoryPermission_EmployeeCategoryId_fkey] FOREIGN KEY ([EmployeeCategoryId]) REFERENCES [dbo].[EmployeeCategory]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CategoryPermission] ADD CONSTRAINT [CategoryPermission_PermissionId_fkey] FOREIGN KEY ([PermissionId]) REFERENCES [dbo].[Permission]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CategoryPermission] ADD CONSTRAINT [CategoryPermission_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[UserPermission] ADD CONSTRAINT [UserPermission_UserId_fkey] FOREIGN KEY ([UserId]) REFERENCES [dbo].[User]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[UserPermission] ADD CONSTRAINT [UserPermission_PermissionId_fkey] FOREIGN KEY ([PermissionId]) REFERENCES [dbo].[Permission]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[UserPermission] ADD CONSTRAINT [UserPermission_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ApprovalPool] ADD CONSTRAINT [ApprovalPool_OrganizationUnitId_fkey] FOREIGN KEY ([OrganizationUnitId]) REFERENCES [dbo].[OrganizationUnit]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ApprovalPool] ADD CONSTRAINT [ApprovalPool_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ApprovalPool] ADD CONSTRAINT [ApprovalPool_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ApprovalPoolMember] ADD CONSTRAINT [ApprovalPoolMember_ApprovalPoolId_fkey] FOREIGN KEY ([ApprovalPoolId]) REFERENCES [dbo].[ApprovalPool]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ApprovalPoolMember] ADD CONSTRAINT [ApprovalPoolMember_EmployeeId_fkey] FOREIGN KEY ([EmployeeId]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ApprovalPoolMember] ADD CONSTRAINT [ApprovalPoolMember_InterimEmployeeId_fkey] FOREIGN KEY ([InterimEmployeeId]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ApprovalPoolMember] ADD CONSTRAINT [ApprovalPoolMember_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ApprovalDecision] ADD CONSTRAINT [ApprovalDecision_ApprovalPoolMemberId_fkey] FOREIGN KEY ([ApprovalPoolMemberId]) REFERENCES [dbo].[ApprovalPoolMember]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ApprovalDecision] ADD CONSTRAINT [ApprovalDecision_DirectValidatorEmployeeId_fkey] FOREIGN KEY ([DirectValidatorEmployeeId]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ApprovalDecision] ADD CONSTRAINT [ApprovalDecision_ValidatedByEmployeeId_fkey] FOREIGN KEY ([ValidatedByEmployeeId]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ApprovalDecision] ADD CONSTRAINT [ApprovalDecision_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CompanySettings] ADD CONSTRAINT [CompanySettings_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Calendar] ADD CONSTRAINT [Calendar_EmployeeCategoryId_fkey] FOREIGN KEY ([EmployeeCategoryId]) REFERENCES [dbo].[EmployeeCategory]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Calendar] ADD CONSTRAINT [Calendar_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Calendar] ADD CONSTRAINT [Calendar_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CalendarWorkDay] ADD CONSTRAINT [CalendarWorkDay_CalendarId_fkey] FOREIGN KEY ([CalendarId]) REFERENCES [dbo].[Calendar]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Holiday] ADD CONSTRAINT [Holiday_OrganizationUnitId_fkey] FOREIGN KEY ([OrganizationUnitId]) REFERENCES [dbo].[OrganizationUnit]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Holiday] ADD CONSTRAINT [Holiday_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LeaveType] ADD CONSTRAINT [LeaveType_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LeaveType] ADD CONSTRAINT [LeaveType_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LeaveType] ADD CONSTRAINT [LeaveType_OrganizationUnitId_fkey] FOREIGN KEY ([OrganizationUnitId]) REFERENCES [dbo].[OrganizationUnit]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EmployeeLeaveBalance] ADD CONSTRAINT [EmployeeLeaveBalance_EmployeeId_fkey] FOREIGN KEY ([EmployeeId]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EmployeeLeaveBalance] ADD CONSTRAINT [EmployeeLeaveBalance_LeaveTypeId_fkey] FOREIGN KEY ([LeaveTypeId]) REFERENCES [dbo].[LeaveType]([Id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LeaveTransaction] ADD CONSTRAINT [LeaveTransaction_EmployeeId_fkey] FOREIGN KEY ([EmployeeId]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LeaveTransaction] ADD CONSTRAINT [LeaveTransaction_LeaveTypeId_fkey] FOREIGN KEY ([LeaveTypeId]) REFERENCES [dbo].[LeaveType]([Id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LeaveTransaction] ADD CONSTRAINT [LeaveTransaction_LeaveRequestId_fkey] FOREIGN KEY ([LeaveRequestId]) REFERENCES [dbo].[LeaveRequest]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LeaveTransaction] ADD CONSTRAINT [LeaveTransaction_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LeaveCancellation] ADD CONSTRAINT [LeaveCancellation_EmployeeId_fkey] FOREIGN KEY ([EmployeeId]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LeaveCancellation] ADD CONSTRAINT [LeaveCancellation_LeaveTypeId_fkey] FOREIGN KEY ([LeaveTypeId]) REFERENCES [dbo].[LeaveType]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LeaveCancellation] ADD CONSTRAINT [LeaveCancellation_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LeaveRequest] ADD CONSTRAINT [LeaveRequest_EmployeeId_fkey] FOREIGN KEY ([EmployeeId]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LeaveRequest] ADD CONSTRAINT [LeaveRequest_LeaveTypeId_fkey] FOREIGN KEY ([LeaveTypeId]) REFERENCES [dbo].[LeaveType]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LeaveRequest] ADD CONSTRAINT [LeaveRequest_InterimEmployeeId_fkey] FOREIGN KEY ([InterimEmployeeId]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LeaveRequest] ADD CONSTRAINT [LeaveRequest_ApprovalPoolId_fkey] FOREIGN KEY ([ApprovalPoolId]) REFERENCES [dbo].[ApprovalPool]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LeaveRequest] ADD CONSTRAINT [LeaveRequest_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[LeaveRequest] ADD CONSTRAINT [LeaveRequest_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MissionOrder] ADD CONSTRAINT [MissionOrder_EmployeeId_fkey] FOREIGN KEY ([EmployeeId]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MissionOrder] ADD CONSTRAINT [MissionOrder_ApprovalPoolId_fkey] FOREIGN KEY ([ApprovalPoolId]) REFERENCES [dbo].[ApprovalPool]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MissionOrder] ADD CONSTRAINT [MissionOrder_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MissionOrder] ADD CONSTRAINT [MissionOrder_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MissionOrder] ADD CONSTRAINT [MissionOrder_LinkedMissionOrderId_fkey] FOREIGN KEY ([LinkedMissionOrderId]) REFERENCES [dbo].[MissionOrder]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MissionExpenseLine] ADD CONSTRAINT [MissionExpenseLine_MissionOrderId_fkey] FOREIGN KEY ([MissionOrderId]) REFERENCES [dbo].[MissionOrder]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MissionExpenseLine] ADD CONSTRAINT [MissionExpenseLine_ExpenseTypeId_fkey] FOREIGN KEY ([ExpenseTypeId]) REFERENCES [dbo].[ExpenseType]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MissionExpenseLine] ADD CONSTRAINT [MissionExpenseLine_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExpenseReport] ADD CONSTRAINT [ExpenseReport_MissionOrderId_fkey] FOREIGN KEY ([MissionOrderId]) REFERENCES [dbo].[MissionOrder]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExpenseReport] ADD CONSTRAINT [ExpenseReport_EmployeeId_fkey] FOREIGN KEY ([EmployeeId]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExpenseReport] ADD CONSTRAINT [ExpenseReport_ApprovalPoolId_fkey] FOREIGN KEY ([ApprovalPoolId]) REFERENCES [dbo].[ApprovalPool]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExpenseReport] ADD CONSTRAINT [ExpenseReport_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExpenseReport] ADD CONSTRAINT [ExpenseReport_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExpenseLine] ADD CONSTRAINT [ExpenseLine_ExpenseReportId_fkey] FOREIGN KEY ([ExpenseReportId]) REFERENCES [dbo].[ExpenseReport]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExpenseLine] ADD CONSTRAINT [ExpenseLine_ExpenseTypeId_fkey] FOREIGN KEY ([ExpenseTypeId]) REFERENCES [dbo].[ExpenseType]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExpenseLine] ADD CONSTRAINT [ExpenseLine_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExpenseLine] ADD CONSTRAINT [ExpenseLine_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EmployeeCategory] ADD CONSTRAINT [EmployeeCategory_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EmployeeCategory] ADD CONSTRAINT [EmployeeCategory_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExpenseType] ADD CONSTRAINT [ExpenseType_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExpenseType] ADD CONSTRAINT [ExpenseType_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExpenseConfig] ADD CONSTRAINT [ExpenseConfig_EmployeeCategoryId_fkey] FOREIGN KEY ([EmployeeCategoryId]) REFERENCES [dbo].[EmployeeCategory]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExpenseConfig] ADD CONSTRAINT [ExpenseConfig_ExpenseTypeId_fkey] FOREIGN KEY ([ExpenseTypeId]) REFERENCES [dbo].[ExpenseType]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExpenseConfig] ADD CONSTRAINT [ExpenseConfig_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExpenseConfig] ADD CONSTRAINT [ExpenseConfig_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExpenseCeiling] ADD CONSTRAINT [ExpenseCeiling_EmployeeCategoryId_fkey] FOREIGN KEY ([EmployeeCategoryId]) REFERENCES [dbo].[EmployeeCategory]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExpenseCeiling] ADD CONSTRAINT [ExpenseCeiling_ExpenseTypeId_fkey] FOREIGN KEY ([ExpenseTypeId]) REFERENCES [dbo].[ExpenseType]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExpenseCeiling] ADD CONSTRAINT [ExpenseCeiling_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ExpenseCeiling] ADD CONSTRAINT [ExpenseCeiling_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Attachment] ADD CONSTRAINT [Attachment_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Notification] ADD CONSTRAINT [Notification_EmployeeId_fkey] FOREIGN KEY ([EmployeeId]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[HiringRequest] ADD CONSTRAINT [HiringRequest_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[HiringRequest] ADD CONSTRAINT [HiringRequest_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[HiringRequest] ADD CONSTRAINT [HiringRequest_PositionId_fkey] FOREIGN KEY ([PositionId]) REFERENCES [dbo].[Position]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[JobOffer] ADD CONSTRAINT [JobOffer_HiringRequestId_fkey] FOREIGN KEY ([HiringRequestId]) REFERENCES [dbo].[HiringRequest]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[JobOffer] ADD CONSTRAINT [JobOffer_InterviewEvaluationTemplateId_fkey] FOREIGN KEY ([InterviewEvaluationTemplateId]) REFERENCES [dbo].[InterviewEvaluationTemplate]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[JobOffer] ADD CONSTRAINT [JobOffer_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[JobOffer] ADD CONSTRAINT [JobOffer_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[InterviewEvaluationTemplate] ADD CONSTRAINT [InterviewEvaluationTemplate_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[InterviewEvaluationTemplate] ADD CONSTRAINT [InterviewEvaluationTemplate_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[InterviewEvaluationCriterion] ADD CONSTRAINT [InterviewEvaluationCriterion_TemplateId_fkey] FOREIGN KEY ([TemplateId]) REFERENCES [dbo].[InterviewEvaluationTemplate]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RecruitmentApplication] ADD CONSTRAINT [RecruitmentApplication_JobOfferId_fkey] FOREIGN KEY ([JobOfferId]) REFERENCES [dbo].[JobOffer]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RecruitmentApplication] ADD CONSTRAINT [RecruitmentApplication_EmployeeId_fkey] FOREIGN KEY ([EmployeeId]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RecruitmentApplication] ADD CONSTRAINT [RecruitmentApplication_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RecruitmentApplication] ADD CONSTRAINT [RecruitmentApplication_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ApplicationNote] ADD CONSTRAINT [ApplicationNote_ApplicationId_fkey] FOREIGN KEY ([ApplicationId]) REFERENCES [dbo].[RecruitmentApplication]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Interview] ADD CONSTRAINT [Interview_ApplicationId_fkey] FOREIGN KEY ([ApplicationId]) REFERENCES [dbo].[RecruitmentApplication]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Interview] ADD CONSTRAINT [Interview_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Interview] ADD CONSTRAINT [Interview_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[InterviewParticipant] ADD CONSTRAINT [InterviewParticipant_InterviewId_fkey] FOREIGN KEY ([InterviewId]) REFERENCES [dbo].[Interview]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[InterviewParticipant] ADD CONSTRAINT [InterviewParticipant_EmployeeId_fkey] FOREIGN KEY ([EmployeeId]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[InterviewEvaluation] ADD CONSTRAINT [InterviewEvaluation_InterviewId_fkey] FOREIGN KEY ([InterviewId]) REFERENCES [dbo].[Interview]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[InterviewCriterionScore] ADD CONSTRAINT [InterviewCriterionScore_EvaluationId_fkey] FOREIGN KEY ([EvaluationId]) REFERENCES [dbo].[InterviewEvaluation]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RecruitmentContract] ADD CONSTRAINT [RecruitmentContract_ApplicationId_fkey] FOREIGN KEY ([ApplicationId]) REFERENCES [dbo].[RecruitmentApplication]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RecruitmentContract] ADD CONSTRAINT [RecruitmentContract_TemplateId_fkey] FOREIGN KEY ([TemplateId]) REFERENCES [dbo].[ContractTemplate]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RecruitmentContract] ADD CONSTRAINT [RecruitmentContract_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RecruitmentContract] ADD CONSTRAINT [RecruitmentContract_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RecruitmentContract] ADD CONSTRAINT [RecruitmentContract_CreatedEmployeeId_fkey] FOREIGN KEY ([CreatedEmployeeId]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ContractNegotiationRound] ADD CONSTRAINT [ContractNegotiationRound_ContractId_fkey] FOREIGN KEY ([ContractId]) REFERENCES [dbo].[RecruitmentContract]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ContractTemplate] ADD CONSTRAINT [ContractTemplate_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ContractTemplate] ADD CONSTRAINT [ContractTemplate_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TrialEmployee] ADD CONSTRAINT [TrialEmployee_ContractId_fkey] FOREIGN KEY ([ContractId]) REFERENCES [dbo].[RecruitmentContract]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TrialEmployee] ADD CONSTRAINT [TrialEmployee_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TrialEmployee] ADD CONSTRAINT [TrialEmployee_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TrialEmployee] ADD CONSTRAINT [TrialEmployee_CreatedEmployeeId_fkey] FOREIGN KEY ([CreatedEmployeeId]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TalentPoolEntry] ADD CONSTRAINT [TalentPoolEntry_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TalentPoolEntry] ADD CONSTRAINT [TalentPoolEntry_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TalentPoolEvaluation] ADD CONSTRAINT [TalentPoolEvaluation_TalentPoolEntryId_fkey] FOREIGN KEY ([TalentPoolEntryId]) REFERENCES [dbo].[TalentPoolEntry]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[DistributionChannel] ADD CONSTRAINT [DistributionChannel_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[DistributionChannel] ADD CONSTRAINT [DistributionChannel_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[JobOfferDistribution] ADD CONSTRAINT [JobOfferDistribution_JobOfferId_fkey] FOREIGN KEY ([JobOfferId]) REFERENCES [dbo].[JobOffer]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[JobOfferDistribution] ADD CONSTRAINT [JobOfferDistribution_ChannelId_fkey] FOREIGN KEY ([ChannelId]) REFERENCES [dbo].[DistributionChannel]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[JobOfferDistribution] ADD CONSTRAINT [JobOfferDistribution_CreatedBy_fkey] FOREIGN KEY ([CreatedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[JobOfferDistribution] ADD CONSTRAINT [JobOfferDistribution_ModifiedBy_fkey] FOREIGN KEY ([ModifiedBy]) REFERENCES [dbo].[Employee]([Id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ── Correctif : index unique FILTRE sur Employee.UserId ────────────────
-- La contrainte generee ci-dessus n'autoriserait qu'UNE SEULE ligne NULL
-- sur toute la colonne (specificite SQL Server) : le deuxieme employe sans
-- compte utilisateur — le cas normal — serait rejete sur un faux conflit
-- d'unicite. L'index filtre autorise autant de NULL que necessaire tout en
-- empechant toujours deux employes de partager le meme compte.
ALTER TABLE [dbo].[Employee] DROP CONSTRAINT [Employee_UserId_key];
CREATE UNIQUE NONCLUSTERED INDEX [Employee_UserId_key] ON [dbo].[Employee]([UserId]) WHERE [UserId] IS NOT NULL;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
