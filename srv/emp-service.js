module.exports = async srv => {

    let sfsfSrv = await cds.connect.to('sfsf');
    const messaging = await cds.connect.to('messaging');
    const xsenv = require('@sap/xsenv');
    const rp = require('request-promise');
    const dest_service = xsenv.getServices({ dest: { tag: 'destination' } }).dest;
    const uaa_service = xsenv.getServices({ uaa: { tag: 'xsuaa' } }).uaa;
    const sUaaCredentials = dest_service.clientid + ':' + dest_service.clientsecret;
    const { Employee } = srv.entities

    const getdestinationDetails = async (destination) => {
        let tokenData = await rp({
            uri: uaa_service.url + '/oauth/token',
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + Buffer.from(sUaaCredentials).toString('base64'),
                'Content-type': 'application/x-www-form-urlencoded'
            },
            form: {
                'client_id': dest_service.clientid,
                'grant_type': 'client_credentials'
            }
        })
        const token = JSON.parse(tokenData).access_token;
        let destinationData = await rp({
            uri: dest_service.uri + '/destination-configuration/v1/destinations/' + destination,
            headers: {
                'Authorization': 'Bearer ' + token
            }
        });

        const oDestination = JSON.parse(destinationData);
        console.log(oDestination.destinationConfiguration.hasOwnProperty("audience"))
        if (oDestination.destinationConfiguration.hasOwnProperty("audience") && oDestination.destinationConfiguration.audience.toString().includes("successfactors")) {
            return true;
        }
        else { return false; }

    };
    messaging.on('sap/successfactors/SFPART065552/isc/contractchange', async (msg) => {
        console.log("<< create event caught", msg);


        let employee = msg.data
        let id = employee.userId

        let { years, months, days, totalDays } = await calcSeniorityTotalDays(employee)

        let payload = await getSeniorityPayload(id, years, months, days, totalDays)
        let response = await sfsfSrv.post("/upsert", payload)
        console.log(response)
    });

    const calcSeniorityTotalDays = async (employee) => {

        const status = employee.status;
        Object.keys(employee).forEach(key => {
            if (employee[key] === '') {
                employee[key] = null;
            }
        });

        // START SENIORITY RULES

        let hireDate = new Date(employee.hireDate)
        let terminationDate = new Date(employee.terminationDate)
        let originalStartDate = new Date(employee.originalStartDate)
        let diffInMs = null;

        if (status.includes("HIR", 0)) {
            diffInMs = Date.now() - hireDate;
        }
        else if (status.includes("TER", 0)) {
            diffInMs = Math.abs(terminationDate - originalStartDate);
        }
        else if (status.includes("RE", 0)) {
            let history = await srv.run(SELECT.one.from(Employee).where({ userId: employee.userId, status: { like: '%TER%' } }).orderBy('terminationDate desc'));
            if (history != null && history.terminationDate != null) {
                terminationDate = new Date(history.terminationDate)
                diffInMs = Math.abs(hireDate - terminationDate);
                diffInMs = diffInMs > 180 * (1000 * 60 * 60 * 24) ? Date.now() - hireDate : Math.abs(terminationDate - originalStartDate) + Math.abs(Date.now() - hireDate);
            }
        }

        let diffInDays = Math.round(diffInMs / (1000 * 60 * 60 * 24));
        let years = Math.floor(diffInDays / 365.25);
        let months = Math.floor(diffInDays % 365.25 / 30);
        let days = Math.floor(diffInDays % 365.25 % 30);

        // END SENIORITY RULES
        employee.seniority = diffInDays
        srv.run(INSERT.into(Employee).entries(employee));

        return { years: years, months: months, days: days, totalDays: diffInDays };
    }

    const getSeniorityPayload = async (userId, years, months, days, totalDays) => {
        let issfsf = await getdestinationDetails(sfsfSrv.destination);
    if(issfsf){
      return {
        __metadata: {
          uri: `https://apisalesdemo8.successfactors.com:443/odata/v2/EmpEmployment(personIdExternal='${userId}',userId='${userId}')`,
          type: "SFOData.EmpEmployment",
        },
        customString1: years.toString(),
        customString2: months.toString(),
        customString3: days.toString(),
        customString4: totalDays.toString(),
      };
    }
    else{
      return {
        userId:userId,
        customString1: years.toString(),
        customString2: months.toString(),
        customString3: days.toString(),
        customString4: totalDays.toString(),
      };
    }
    }
}
