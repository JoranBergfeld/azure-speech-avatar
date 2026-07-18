targetScope = 'subscription'

@minLength(1)
@description('azd environment name (used as prefix).')
param environmentName string

@minLength(1)
@description('Primary location for all resources.')
param location string

@description('Container image; azd sets this after building.')
param containerImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: 'rg-${environmentName}'
  location: location
}

module resources 'resources.bicep' = {
  name: 'resources'
  scope: rg
  params: {
    location: location
    prefix: environmentName
    containerImage: containerImage
  }
}

output WEB_URI string = resources.outputs.WEB_URI
output AZURE_OPENAI_ENDPOINT string = resources.outputs.AZURE_OPENAI_ENDPOINT
output SPEECH_REGION string = resources.outputs.SPEECH_REGION
output SPEECH_RESOURCE_ID string = resources.outputs.SPEECH_RESOURCE_ID
