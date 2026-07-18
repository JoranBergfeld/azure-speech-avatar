@description('Azure region for all resources.')
param location string

@description('Resource name prefix / azd environment name.')
param prefix string

@description('Model deployment name (must match AzureOpenAI:Deployment).')
param modelDeployment string = 'gpt-4.1'

@description('Container image reference; azd overrides this at deploy time.')
param containerImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

var uniqueSuffix = uniqueString(resourceGroup().id)
var aiName = toLower('${prefix}-aoai-${uniqueSuffix}')
var speechName = toLower('${prefix}-spch-${uniqueSuffix}')
var lawName = toLower('${prefix}-law-${uniqueSuffix}')
var envName = toLower('${prefix}-cae-${uniqueSuffix}')
var appName = toLower('${prefix}-ca-${uniqueSuffix}')

var openAiUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'   // Cognitive Services OpenAI User
var speechUserRoleId = 'f2dc8367-1007-4938-bd23-fe263f013447'   // Cognitive Services Speech User

resource law 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: lawName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource aiAccount 'Microsoft.CognitiveServices/accounts@2025-04-01-preview' = {
  name: aiName
  location: location
  kind: 'AIServices'
  sku: { name: 'S0' }
  identity: { type: 'SystemAssigned' }
  properties: {
    customSubDomainName: aiName
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

resource model 'Microsoft.CognitiveServices/accounts/deployments@2025-04-01-preview' = {
  parent: aiAccount
  name: modelDeployment
  sku: { name: 'GlobalStandard', capacity: 40 }
  properties: {
    model: { format: 'OpenAI', name: 'gpt-4.1', version: '2025-04-14' }
  }
}

resource speech 'Microsoft.CognitiveServices/accounts@2025-04-01-preview' = {
  name: speechName
  location: location
  kind: 'SpeechServices'
  sku: { name: 'S0' }
  properties: {
    customSubDomainName: speechName
    disableLocalAuth: true
    publicNetworkAccess: 'Enabled'
  }
}

resource caEnv 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: envName
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: law.properties.customerId
        sharedKey: law.listKeys().primarySharedKey
      }
    }
  }
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  identity: { type: 'SystemAssigned' }
  tags: { 'azd-service-name': 'web' }
  properties: {
    managedEnvironmentId: caEnv.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
      }
    }
    template: {
      containers: [
        {
          name: 'web'
          image: containerImage
          resources: { cpu: json('0.5'), memory: '1.0Gi' }
          env: [
            { name: 'AzureOpenAI__Endpoint', value: aiAccount.properties.endpoint }
            { name: 'AzureOpenAI__Deployment', value: modelDeployment }
            { name: 'Speech__Region', value: location }
            { name: 'Speech__ResourceId', value: speech.id }
          ]
        }
      ]
      scale: { minReplicas: 1, maxReplicas: 2 }
    }
  }
}

resource openAiRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(aiAccount.id, app.id, openAiUserRoleId)
  scope: aiAccount
  properties: {
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', openAiUserRoleId)
  }
}

resource speechRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(speech.id, app.id, speechUserRoleId)
  scope: speech
  properties: {
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', speechUserRoleId)
  }
}

output WEB_URI string = 'https://${app.properties.configuration.ingress.fqdn}'
output AZURE_OPENAI_ENDPOINT string = aiAccount.properties.endpoint
output SPEECH_REGION string = location
output SPEECH_RESOURCE_ID string = speech.id
