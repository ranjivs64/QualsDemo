@description('Project name used in resource naming.')
@minLength(3)
@maxLength(20)
param projectName string

@description('Deployment environment.')
@allowed([
  'dev'
  'staging'
  'prod'
])
param environmentName string

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('App Service plan SKU name.')
@allowed([
  'B1'
  'S1'
  'P1v3'
])
param appServiceSkuName string = 'B1'

@description('Azure OpenAI deployment API version used by the application.')
param foundryApiVersion string = '2025-03-01-preview'

@description('Azure AI Document Intelligence API version used by the application.')
param documentIntelligenceApiVersion string = '2024-11-30'

@description('Azure AI Document Intelligence model used by the application.')
param documentIntelligenceModel string = 'prebuilt-layout'

@description('Azure AI Document Intelligence output format used by the application.')
@allowed([
  'markdown'
  'text'
])
param documentIntelligenceOutputFormat string = 'markdown'

@description('Key Vault secret name that stores the Document Intelligence API key.')
param documentIntelligenceApiKeySecretName string = 'document-intelligence-api-key'

@description('Azure OpenAI model or deployment name used by the application.')
param foundryModel string = 'gpt-5'

@description('Azure OpenAI model version to deploy.')
param foundryModelVersion string = '2025-08-07'

@description('Azure OpenAI deployment SKU name.')
param aiDeploymentSkuName string = 'GlobalStandard'

@description('Azure OpenAI deployment capacity.')
@minValue(1)
param aiDeploymentCapacity int = 10

@description('Key Vault secret name that stores the Foundry API key.')
param foundryApiKeySecretName string = 'foundry-api-key'

@description('Node environment for the application.')
@allowed([
  'production'
  'staging'
])
param nodeEnvironment string = 'production'

@description('Timeout in milliseconds for authoritative AI extraction requests.')
@minValue(1)
param qualAiTimeoutMs int = 300000

@description('Timeout in milliseconds for Azure AI Document Intelligence analysis requests.')
@minValue(1)
param documentIntelligenceTimeoutMs int = 300000

var normalizedProjectName = toLower(replace(replace(projectName, '-', ''), '_', ''))
var resourceSuffix = uniqueString(resourceGroup().id, projectName, environmentName)
var webAppName = toLower('app-${projectName}-${environmentName}-${take(resourceSuffix, 6)}')
var appServicePlanName = 'asp-${projectName}-${environmentName}'
var appInsightsName = 'appi-${projectName}-${environmentName}'
var keyVaultName = take('kv${normalizedProjectName}${environmentName}${resourceSuffix}', 24)
var openAiAccountName = take('aoai${normalizedProjectName}${environmentName}${resourceSuffix}', 24)
var documentIntelligenceAccountName = take('di${normalizedProjectName}${environmentName}${resourceSuffix}', 24)
var openAiDeploymentName = take(replace(toLower(foundryModel), '.', '-'), 64)
var commonTags = {
  Environment: environmentName
  Project: projectName
  ManagedBy: 'Bicep'
}
var appServiceSkuTier = appServiceSkuName == 'P1v3'
  ? 'PremiumV3'
  : appServiceSkuName == 'S1'
    ? 'Standard'
    : 'Basic'

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  tags: commonTags
  properties: {
    Application_Type: 'web'
    Flow_Type: 'Bluefield'
    Request_Source: 'rest'
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: commonTags
  properties: {
    accessPolicies: []
    tenantId: tenant().tenantId
    enableRbacAuthorization: false
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: false
    publicNetworkAccess: 'Enabled'
    softDeleteRetentionInDays: 7
    sku: {
      family: 'A'
      name: 'standard'
    }
  }
}

resource openAiAccount 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: openAiAccountName
  location: location
  kind: 'OpenAI'
  tags: commonTags
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: openAiAccountName
    publicNetworkAccess: 'Enabled'
  }
}

resource documentIntelligenceAccount 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: documentIntelligenceAccountName
  location: location
  kind: 'FormRecognizer'
  tags: commonTags
  sku: {
    name: 'S0'
  }
  properties: {
    customSubDomainName: documentIntelligenceAccountName
    publicNetworkAccess: 'Enabled'
  }
}

resource openAiDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: openAiAccount
  name: openAiDeploymentName
  sku: {
    name: aiDeploymentSkuName
    capacity: aiDeploymentCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: foundryModel
      version: foundryModelVersion
    }
    versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
  }
}

resource foundryApiKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: foundryApiKeySecretName
  properties: {
    value: openAiAccount.listKeys().key1
  }
}

resource documentIntelligenceApiKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: documentIntelligenceApiKeySecretName
  properties: {
    value: documentIntelligenceAccount.listKeys().key1
  }
}

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanName
  location: location
  kind: 'linux'
  tags: commonTags
  sku: {
    name: appServiceSkuName
    tier: appServiceSkuTier
    size: appServiceSkuName
    capacity: 1
  }
  properties: {
    reserved: true
  }
}

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  kind: 'app,linux'
  identity: {
    type: 'SystemAssigned'
  }
  tags: commonTags
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      alwaysOn: environmentName != 'dev'
      ftpsState: 'Disabled'
      healthCheckPath: '/api/v1/health'
      http20Enabled: true
      linuxFxVersion: 'NODE|24-lts'
      minTlsVersion: '1.2'
    }
  }
  dependsOn: [
    foundryApiKeySecret
    documentIntelligenceApiKeySecret
  ]
}

resource keyVaultWebAppAccessPolicy 'Microsoft.KeyVault/vaults/accessPolicies@2023-07-01' = {
  parent: keyVault
  name: 'add'
  properties: {
    accessPolicies: [
      {
        tenantId: tenant().tenantId
        objectId: webApp.identity.principalId
        permissions: {
          secrets: [
            'get'
          ]
        }
      }
    ]
  }
}

resource webAppAppSettings 'Microsoft.Web/sites/config@2023-12-01' = {
  parent: webApp
  name: 'appsettings'
  properties: {
    APPLICATIONINSIGHTS_CONNECTION_STRING: applicationInsights.properties.ConnectionString
    NODE_ENV: nodeEnvironment
    QUAL_AI_PROVIDER: 'foundry'
    QUAL_AI_TIMEOUT_MS: string(qualAiTimeoutMs)
    DOCUMENT_INTELLIGENCE_ENDPOINT: documentIntelligenceAccount.properties.endpoint
    DOCUMENT_INTELLIGENCE_API_KEY: '@Microsoft.KeyVault(VaultName=${keyVault.name};SecretName=${documentIntelligenceApiKeySecretName})'
    DOCUMENT_INTELLIGENCE_API_VERSION: documentIntelligenceApiVersion
    DOCUMENT_INTELLIGENCE_MODEL: documentIntelligenceModel
    DOCUMENT_INTELLIGENCE_OUTPUT_FORMAT: documentIntelligenceOutputFormat
    DOCUMENT_INTELLIGENCE_TIMEOUT_MS: string(documentIntelligenceTimeoutMs)
    FOUNDRY_ENDPOINT: openAiAccount.properties.endpoint
    FOUNDRY_API_VERSION: foundryApiVersion
    QUAL_AI_MODEL: openAiDeployment.name
    FOUNDRY_API_KEY: '@Microsoft.KeyVault(VaultName=${keyVault.name};SecretName=${foundryApiKeySecretName})'
    ENABLE_ORYX_BUILD: 'false'
    QUAL_DB_PATH: '/home/site/data/qualextract.sqlite'
    QUAL_UPLOADS_DIR: '/home/site/uploads'
    SCM_DO_BUILD_DURING_DEPLOYMENT: 'false'
    WEBSITE_RUN_FROM_PACKAGE: '1'
  }
  dependsOn: [
    foundryApiKeySecret
    documentIntelligenceApiKeySecret
    keyVaultWebAppAccessPolicy
  ]
}

output webAppName string = webApp.name
output webAppHostName string = webApp.properties.defaultHostName
output keyVaultName string = keyVault.name
output applicationInsightsName string = applicationInsights.name
output appServicePlanName string = appServicePlan.name
output openAiAccountName string = openAiAccount.name
output openAiEndpoint string = openAiAccount.properties.endpoint
output openAiDeploymentName string = openAiDeployment.name
output documentIntelligenceAccountName string = documentIntelligenceAccount.name
output documentIntelligenceEndpoint string = documentIntelligenceAccount.properties.endpoint
