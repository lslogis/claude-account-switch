# The AccountSwitcher module's manifest. Its version follows the plugin's
# (.claude-plugin/plugin.json; bump both together, the Pester tests check they match); FunctionsToExport lists
# the functions of Public\, which are what the module exports (the Pester tests hold it to them). Its messages are
# in en-US\AccountSwitcher.psd1.
@{
    RootModule           = 'AccountSwitcher.psm1'
    ModuleVersion        = '1.2.0'
    GUID                 = 'e097104e-18df-4c0b-85a4-701b70368487'
    Description          = 'Saved sign-ins for Claude Desktop on Windows, and the Code session lists the saved accounts may share (unofficial).'
    PowerShellVersion    = '5.1'
    CompatiblePSEditions = @('Desktop')
    FunctionsToExport    = @(
        'Invoke-AccountSwitcher'
        'Save-SignedInAccount'
        'Add-AccountProfile'
        'Rename-AccountProfile'
        'Remove-AccountProfile'
        'Set-AccountProfileSharing'
        'Switch-AccountProfile'
    )
    CmdletsToExport      = @()
    VariablesToExport    = @()
    AliasesToExport      = @()
    PrivateData          = @{
        PSData = @{
            Tags = @('Claude', 'ClaudeDesktop', 'Windows')
        }
    }
}
