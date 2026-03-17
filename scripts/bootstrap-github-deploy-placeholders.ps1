param(
    [string]$Repository = 'ranjivs64/QualsDemo',
    [string[]]$Environments = @('dev', 'staging', 'prod'),
    [string]$AzureClientIdPlaceholder = 'replace-with-real-client-id',
    [string]$AzureTenantIdPlaceholder = 'replace-with-real-tenant-id',
    [string]$AzureClientSecretPlaceholder = 'replace-with-real-client-secret'
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

    Write-Host "Setting placeholder variables for '$environmentName'"
    Invoke-Gh -Arguments @('variable', 'set', 'AZURE_CLIENT_ID', '--env', $environmentName, '--body', $AzureClientIdPlaceholder, '-R', $Repository) -FailureMessage "Failed to set AZURE_CLIENT_ID for '$environmentName'. Ensure you have admin rights on $Repository."
    Invoke-Gh -Arguments @('variable', 'set', 'AZURE_TENANT_ID', '--env', $environmentName, '--body', $AzureTenantIdPlaceholder, '-R', $Repository) -FailureMessage "Failed to set AZURE_TENANT_ID for '$environmentName'. Ensure you have admin rights on $Repository."

    Write-Host "Setting placeholder secret for '$environmentName'"
    $AzureClientSecretPlaceholder | gh secret set AZURE_CLIENT_SECRET --env $environmentName -R $Repository
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to set AZURE_CLIENT_SECRET for '$environmentName'. Ensure you have admin rights on $Repository."
    }
}

Write-Host 'GitHub deployment placeholder configuration complete.'