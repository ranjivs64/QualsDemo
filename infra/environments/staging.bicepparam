using '../main.bicep'

param projectName = 'qualsdemo'
param environmentName = 'staging'
param location = 'centralus'
param appServiceSkuName = 'S1'
param nodeEnvironment = 'staging'
param qualAiTimeoutMs = 300000
param documentIntelligenceTimeoutMs = 300000
