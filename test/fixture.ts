// Builds pages shaped exactly like FDLE's currentSilverAlerts.asp (same
// classes, attributes, labels and whitespace), filled with fictional people.
// Never put a real alert in here.

export interface RowFields {
  id: string
  fin: string | null
  since: string
  name: string
  race: string
  sex: string
  dob: string
  ageToday: string
  ageMissing: string
  category: string
  from: string
}

export const ROW: RowFields = {
  id: '100001',
  fin: '900001',
  since: '10/19/2026',
  name: 'Example, Jane',
  race: 'White',
  sex: 'Female',
  dob: '3/28/1941',
  ageToday: '85 yrs 6 months',
  ageMissing: '85 yrs',
  category: 'Missing Person',
  from: 'Springfield,FL'
}

const open = (id: string) =>
  `<a href="javascript:;" onclick="OpenWindow('Flyer.asp?ID=${id}','WebFlyer','toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=no','997','654','true')">`

export const row = (overrides: Partial<RowFields> = {}): string => {
  const r = { ...ROW, ...overrides }
  const photo = r.fin
    ? `${open(r.id)}
                                            <img src="GetImage.asp?FIN=${r.fin}"
                                                width="60" height="70" alt="Click to view Flyer" /></a>`
    : ''
  return `
                                <tr>
                                    <td class="TableDataCell" align="center">
                                        ${photo}
                                    </td>
                                    <td class="TableDataCell">
                                        ${r.since}
                                    </td>
                                    <td class="TableDataCell">
                                        ${open(r.id)}
                                            <u>
                                                ${r.name}</u></a>
                                    </td>
                                    <td class="TableDataCell">
                                        Race:
                                        ${r.race}<br />
                                        Sex:
                                        ${r.sex}
                                    </td>
                                    <td class="TableDataCell">
                                        DOB:
                                        ${r.dob}
                                        <br />
                                        Age:
                                        ${r.ageToday}
                                    </td>
                                    <td class="TableDataCell">
                                        ${r.ageMissing}
                                    </td>
                                    <td class="TableDataCell">
                                        ${r.category}
                                    </td>
                                    <td class="TableDataCell">
                                        ${r.from}
                                    </td>
                                </tr>`
}

export const HEADER = `
                                <tr class="TableHeaderRow">
                                    <td class="TableHeaderCellLeft" width="80" style="color: #CFE7FF;">
                                        Click Photo for Flyer
                                    </td>
                                    <td width="50">
                                        Missing Since
                                    </td>
                                    <td width="120">
                                        Name
                                    </td>
                                    <td width="70">
                                        Race / Sex
                                    </td>
                                    <td width="125">
                                        Birth Date Age Today
                                    </td>
                                    <td>
                                        Age Missing
                                    </td>
                                    <td>
                                        Category
                                    </td>
                                    <td class="TableHeaderCellRight">
                                        Missing From
                                    </td>
                                </tr>`

// With no alerts FDLE prints this in place of the whole table.
export const NO_ALERTS = `<center>No Silver Alerts are active at this time.</center><br>`

export const table = (body: string, header = HEADER): string =>
  `<table width="100%" cellpadding="5" cellspacing="0" border="0" class="DataTable">${header}${body}
                            </table>`

export const page = (
  content: string,
  { heading = 'Current Silver Alerts' } = {}
): string => `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html lang="en">
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1" />
    <title>MEPIC :: Alert Results</title>
</head>
<main></main>
<body>
        <div id="MasterWrapper" align="left">
                <div id="SecondaryPageRightColumn">
                    <div id="SecondaryPageHeading">
                        <div id="SecondaryPageRightColumnHeading">
                            ${heading}</div>
                    </div>
                    <div id="SecondaryPageRightColumnContent">
                        <div id="SecondaryPageRightColumnInnerContent" class="ContentText">
                            ${content}
                        </div>
                    </div>
                </div>
        </div>
</body>
</html>`
