param(
    [string]$Repository = 'ranjivs64/QualsDemo',
    [string[]]$Environments = @('dev', 'staging', 'prod'),
    [string]$AzureCredentialsPlaceholder = '{"clientId":"replace-with-real-client-id","clientSecret":"replace-with-real-client-secret","tenantId":"replace-with-real-tenant-id","subscriptionId":"replace-with-real-subscription-id"}'
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw 'GitHub CLI (gh) is required.'
}

function Invoke-Gh {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,

        [Parameter(Mandatory = $true)]
        [string]$FailureMessage
    )

    & gh @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw $FailureMessage
    }
}

foreach ($environmentName in $Environments) {
    Write-Host "Creating or updating GitHub environment '$environmentName' in $Repository"
    Invoke-Gh -Arguments @('api', '--method', 'PUT', "/repos/$Repository/environments/$environmentName") -FailureMessage "Failed to create or update GitHub environment '$environmentName'. Ensure you have admin rights on $Repository."

    Write-Host "Setting placeholder secret for '$environmentName'"
    $AzureCredentialsPlaceholder | gh secret set AZURE_CREDENTIALS --env $environmentName -R $Repository
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to set AZURE_CREDENTIALS for '$environmentName'. Ensure you have admin rights on $Repository."
    }
}

Write-Host 'GitHub deployment placeholder configuration complete.'