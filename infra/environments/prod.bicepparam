using '../main.bicep'

param projectName = 'qualsdemo'
param environmentName = 'prod'
param location = 'centralus'
param appServiceSkuName = 'P1v3'
param qualAiTimeoutMs = 300000
param documentIntelligenceTimeoutMs = 300000
