using '../main.bicep'

param projectName = 'qualsdemo'
param environmentName = 'dev'
param location = 'centralus'
param appServiceSkuName = 'B1'
param qualAiTimeoutMs = 300000
param documentIntelligenceTimeoutMs = 300000
