import { esc } from './layout'

// ---------------------------------------------------------------------------
// Microsoft Word add-in: a task pane inside Word that inserts wording from the firm's clause bank,
// saves selected text as a new clause, and files the open document to a case. It signs in with an
// API key (Settings, API keys) kept in the pane's storage on that computer, and calls /api/v1 on
// this same server. Firms sideload the manifest, or their Microsoft 365 admin deploys it centrally.
// ---------------------------------------------------------------------------

// Fixed so that Word treats every update of the manifest as the same add-in.
export const ADDIN_ID = '6c2f4a1e-8b9d-4e37-a5c1-3f7d2e9b8a41'
export const OFFICE_JS_HOST = 'https://appsforoffice.microsoft.com'
export const OFFICE_JS = `${OFFICE_JS_HOST}/lib/1/hosted/office.js`
// Raise it when the manifest changes, so Office picks up the new one.
export const ADDIN_VERSION = '1.0.0.0'
// Office on the web shows the pane in a frame on these hosts.
export const OFFICE_FRAME_HOSTS = [
  'https://*.officeapps.live.com', 'https://*.office.com', 'https://*.office365.com', 'https://*.microsoft365.com',
  'https://*.sharepoint.com', 'https://*.live.com', 'https://*.cloud.microsoft'
]

export function addinManifest(appUrl: string, version: string) {
  const base = appUrl.replace(/\/$/, '')
  const x = (s: string) => esc(s)
  const pane = `${base}/addin/taskpane`
  // Word scales the one icon the app has to each size it shows.
  const icon = (_size: number) => `${base}/static/icons/icon-192.png`
  return `<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0" xmlns:ov="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="TaskPaneApp">
  <Id>${ADDIN_ID}</Id>
  <Version>${x(version)}</Version>
  <ProviderName>TrustiqLegal</ProviderName>
  <DefaultLocale>en-US</DefaultLocale>
  <DisplayName DefaultValue="TrustiqLegal">
    <Override Locale="ar-SA" Value="ترستيك ليغال" />
  </DisplayName>
  <Description DefaultValue="Insert your firm's approved clauses in English and Arabic, and file documents to TrustiqLegal cases.">
    <Override Locale="ar-SA" Value="أدرج البنود المعتمدة لدى مكتبك بالعربية والإنجليزية، واحفظ المستندات في قضايا ترستيك ليغال." />
  </Description>
  <IconUrl DefaultValue="${x(icon(32))}" />
  <HighResolutionIconUrl DefaultValue="${x(icon(64))}" />
  <SupportUrl DefaultValue="${x(`${base}/developers`)}" />
  <AppDomains>
    <AppDomain>${x(base)}</AppDomain>
  </AppDomains>
  <Hosts>
    <Host Name="Document" />
  </Hosts>
  <Requirements>
    <Sets DefaultMinVersion="1.1">
      <Set Name="WordApi" MinVersion="1.3" />
    </Sets>
  </Requirements>
  <DefaultSettings>
    <SourceLocation DefaultValue="${x(pane)}" />
  </DefaultSettings>
  <Permissions>ReadWriteDocument</Permissions>
  <VersionOverrides xmlns="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="VersionOverridesV1_0">
    <Hosts>
      <Host xsi:type="Document">
        <DesktopFormFactor>
          <ExtensionPoint xsi:type="PrimaryCommandSurface">
            <OfficeTab id="TabHome">
              <Group id="TrustiqLegal.Group">
                <Label resid="TrustiqLegal.GroupLabel" />
                <Icon>
                  <bt:Image size="16" resid="TrustiqLegal.Icon" />
                  <bt:Image size="32" resid="TrustiqLegal.Icon" />
                  <bt:Image size="80" resid="TrustiqLegal.Icon" />
                </Icon>
                <Control xsi:type="Button" id="TrustiqLegal.OpenPane">
                  <Label resid="TrustiqLegal.ButtonLabel" />
                  <Supertip>
                    <Title resid="TrustiqLegal.ButtonLabel" />
                    <Description resid="TrustiqLegal.ButtonTip" />
                  </Supertip>
                  <Icon>
                    <bt:Image size="16" resid="TrustiqLegal.Icon" />
                    <bt:Image size="32" resid="TrustiqLegal.Icon" />
                    <bt:Image size="80" resid="TrustiqLegal.Icon" />
                  </Icon>
                  <Action xsi:type="ShowTaskpane">
                    <TaskpaneId>TrustiqLegal.Pane</TaskpaneId>
                    <SourceLocation resid="TrustiqLegal.PaneUrl" />
                  </Action>
                </Control>
              </Group>
            </OfficeTab>
          </ExtensionPoint>
        </DesktopFormFactor>
      </Host>
    </Hosts>
    <Resources>
      <bt:Images>
        <bt:Image id="TrustiqLegal.Icon" DefaultValue="${x(icon(80))}" />
      </bt:Images>
      <bt:Urls>
        <bt:Url id="TrustiqLegal.PaneUrl" DefaultValue="${x(pane)}" />
      </bt:Urls>
      <bt:ShortStrings>
        <bt:String id="TrustiqLegal.GroupLabel" DefaultValue="TrustiqLegal">
          <bt:Override Locale="ar-SA" Value="ترستيك ليغال" />
        </bt:String>
        <bt:String id="TrustiqLegal.ButtonLabel" DefaultValue="Clauses and cases">
          <bt:Override Locale="ar-SA" Value="البنود والقضايا" />
        </bt:String>
      </bt:ShortStrings>
      <bt:LongStrings>
        <bt:String id="TrustiqLegal.ButtonTip" DefaultValue="Open the TrustiqLegal pane: insert approved clauses and save this document to a case.">
          <bt:Override Locale="ar-SA" Value="افتح لوحة ترستيك ليغال: أدرج البنود المعتمدة واحفظ هذا المستند في قضية." />
        </bt:String>
      </bt:LongStrings>
    </Resources>
  </VersionOverrides>
</OfficeApp>
`
}

export function addinTaskpane(assetVersion: string) {
  const v = esc(assetVersion)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TrustiqLegal for Word</title>
  <script src="${OFFICE_JS}"></script>
  <link rel="stylesheet" href="/static/addin/taskpane.css?v=${v}" />
</head>
<body>
  <header><strong>TrustiqLegal</strong><span id="who"></span></header>
  <main id="root"><p class="muted">Loading…</p></main>
  <script src="/static/addin/taskpane.js?v=${v}"></script>
</body>
</html>`
}
