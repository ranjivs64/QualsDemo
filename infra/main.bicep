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
param foundryApiVersion string = '2024-10-21'

@description('Azure OpenAI model or deployment name used by the application.')
param foundryModel string = 'gpt-4o-mini'

@description('Azure OpenAI model version to deploy.')
param foundryModelVersion string = '2024-07-18'

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

var normalizedProjectName = toLower(replace(replace(projectName, '-', ''), '_', ''))
var resourceSuffix = uniqueString(resourceGroup().id, projectName, environmentName)
var webAppName = toLower('app-${projectName}-${environmentName}-${take(resourceSuffix, 6)}')
var appServicePlanName = 'asp-${projectName}-${environmentName}'
var appInsightsName = 'appi-${projectName}-${environmentName}'
var keyVaultName = take('kv${normalizedProjectName}${environmentName}${resourceSuffix}', 24)
var openAiAccountName = take('aoai${normalizedProjectName}${environmentName}${resourceSuffix}', 24)
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
      appSettings: [
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: applicationInsights.properties.ConnectionString
        }
        {
          name: 'NODE_ENV'
          value: nodeEnvironment
        }
        {
          name: 'QUAL_AI_PROVIDER'
          value: 'foundry'
        }
        {
          name: 'FOUNDRY_ENDPOINT'
          value: openAiAccount.properties.endpoint
        }
        {
          name: 'FOUNDRY_API_VERSION'
          value: foundryApiVersion
        }
        {
          name: 'QUAL_AI_MODEL'
          value: openAiDeployment.name
        }
        {
          name: 'FOUNDRY_API_KEY'
          value: '@Microsoft.KeyVault(VaultName=${keyVault.name};SecretName=${foundryApiKeySecretName})'
        }
        {
          name: 'QUAL_DB_PATH'
          value: '/home/site/data/qualextract.sqlite'
        }
        {
          name: 'QUAL_UPLOADS_DIR'
          value: '/home/site/uploads'
        }
        {
          name: 'SCM_DO_BUILD_DURING_DEPLOYMENT'
          value: 'true'
        }
      ]
    }
  }
}

resource keyVaultWebAppAccessPolicy 'Microsoft.KeyVault/vaults/accessPolicies@2023-07-01' = {
  name: '${keyVault.name}/add'
  dependsOn: [
    keyVault
    webApp
  ]
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

output webAppName string = webApp.name
output webAppHostName string = webApp.properties.defaultHostName
output keyVaultName string = keyVault.name
output applicationInsightsName string = applicationInsights.name
output appServicePlanName string = appServicePlan.name
output openAiAccountName string = openAiAccount.name
output openAiEndpoint string = openAiAccount.properties.endpoint
output openAiDeploymentName string = openAiDeployment.name
