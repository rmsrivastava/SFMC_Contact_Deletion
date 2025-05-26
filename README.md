# Using SFMC APIs to automate contact deletion in Enterprise 2.0

## Introduction
Salesforce Marketing Cloud (SFMC) offers a robust Contact Delete feature within Contact Builder, enabling the removal of contact information across all business units in an Enterprise 2.0 account to help ensure compliance with data retention policies and regulatory requirements. If you're new to this topic, I recommend starting with the official documentation.

Please note that you need to enable the service, before starting to delete contacts. To enable Contact Deletion, you must have a Marketing Cloud Administrator role. Navigate to the Parent Business Unit and follow these steps:

  - Go to Audience Builder » Contact Builder » Contacts Configuration.
  - Enable the process in the Contact Delete section. 
  - Configure the suppression period by clicking Manage Settings (default is two days).
  - Save your changes.
  
### Important Considerations

  - In Enterprise 2.0 edition, deletions must occur at the parent level and automatically apply across all Business Units.
  - If you want the Contact Deletion process to trigger automatically after starting it, set the suppression period to 0 days.
  - The deletion process scans all sendable data extensions in an account to remove the specified contact records. To improve the speed of this process, delete any     unnecessary sendable data extensions in your account.
  - The contact deletion process removes selected contacts from all lists, sendable data extensions, groups, and populations. However, it does not check or delete      contacts from non-sendable data extensions. If you have related data in non-sendable data extensions, you'll need to write scripts or SQL query activities to       delete that data separately.

Now let's look at step by step process on how to automate contact deletion of millions of contacts. Note that it takes considerable effort to set it up for the first time but once configured, it is reusable year after year with little fine-tuning. This ensures your data management practices remain efficient and compliant with regulatory standards.

## Step 1: Identify the Contacts to be Deleted
The contact deletion process starts by identifying the contacts that need to be archived. Align this step with the specific business needs of your stakeholders, as these requirements can change annually. 
  - Gather Requirements: Collect requirements from the platform owner and other stakeholders like marketing, sales, data governance and legal.
  - Analyze Data: Isolate records that meet the agreed-upon criteria.
  - Classify Contacts: Classify contacts into smaller groups based on set criteria to prioritize which groups to delete first. This helps organize your analysis        and makes it easier to review with stakeholders and drop any specific group from the final list, if needed.

Once the contacts have been identified and approved for deletion, create a new non-sendable data extension (DE) and use SQL query activities to copy the contacts to be deleted into this DE. This DE serves as an archive of all contacts deleted after the process is complete. It could then be leveraged when deleting related data in non-sendable data extensions, as the contact deletion API does not clean up non-sendable DEs.

Let's call this DE 'ContactsToBeDeleted' and here's the suggested schema:

| Field Name       | Data Type     | Length | PK/Nullable |
|------------------|---------------|--------|-------------|
| SubscriberKey    | Text          | 254    | PK          |
| EmailAddress     | EmailAddress  | 254    |             |
| RowKey           | Number        | —      | Nullable    |

Note that this DE should have a column to store the CustomObjectKey, a hidden identity field in Data Extensions. It is a unique number assigned to each row and can be queried using SQL and assigned to another column. This ‘RowKey’ column will be used later in the process to create batches for contact deletion.
```sql
SELECT SubscriberKey, 
       _CustomObjectKey as RowKey
FROM ContactsToBeDeleted
```
💡 Tip: Some SSJS functions and APIs work only with the external key of the DE (rather than the name). To avoid confusion, copy-paste the DE name as the external key for all DEs used in this process.

## Step 2: Create Batches for Deletion

The time required to process each batch depends on several factors:
  - Batch size
  - The number of sendable Data Extensions (DEs), lists, groups, and populations.
  - Overall load on your Marketing Cloud instance (e.g., sends, imports, automations, and queries).
  - The number of business units involved.

Deletion processes are deprioritized in favor of other account activities, which can significantly increase processing time—especially in environments with high activity and/or many business units.

SFMC's official documentation states that you can delete up to a million contacts at a time but recommends breaking down the total population into smaller batches and submit deletion requests at least 5 minutes apart. In my experience, managing tens of millions of contacts and thousands of sendable DEs across 5-6 business units, we initially encountered errors even with batches of 100,000 contacts. We found that reducing the batch size to 50,000 improved reliability and prevented script timeouts, which would otherwise require manual intervention and compromise automation. That's why finding the right batch size for your account is a crucial step to optimize the automation. Besides, you can always run multiple jobs within a day to speed up the process.

### Batch Calculation

To automate batch processing, we first need to calculate the number of batches based on RowKey and store the results in a non-sendable DE. I use this DE year after year for multiple delete cycles; a new row is added each time a deletion cycle begins. Here is the schema for this DE and the SQL query used to populate this DE:

```sql
SELECT 'ContactsToBeDeleted_2025' AS [Key],
        max(_CustomObjectKey) AS LastRowIndex,
        50000 as BatchSize,
        CEILING((max(_CustomObjectKey) - min(_CustomObjectKey))/50000) AS [Batches], 
min(_CustomObjectKey) AS StartRowIndex
FROM ContactsToBeDeleted
```
## Data Extension Schema

| Field Name     | Data Type (Length) | PK / Nullable |
|----------------|--------------------|---------------|
| Key            | Text (100)         | PK            |
| StartRowIndex  | Number             | Nullable      |
| LastRowIndex   | Number             | Nullable      |
| BatchSize      | Number             | Nullable      |
| Batches        | Number             | Nullable      |

💡 Tip: Using the contact deletion DE name, suffixed with the year, as ‘Key’ track and differentiate deletion cycles across multiple years.

Finally, we conclude this step by creating two identical sets of data extensions: 
  - Sendable Batch DEs – These will be used to feed contact records to the Contact Deletion API in batches.
  - Non-Sendable Backup DEs – These serve as backups of the corresponding Batch DEs, allowing you to repopulate a batch and restart the deletion process in case of     an error.

To enhance clarity and ease of monitoring, I organize the deletion and backup DEs into separate folders. The number of data extensions in each set would be equal to the ‘Batches’ in the above-mentioned 'CA_CustomObjectKeyRange' DE. 
Here's the SSJS (Server-Side JavaScript) script that can be used for creating the two sets of DEs per contact deletion batch.

```javascript
<script runat='server'>

    Platform.Load('core', '1');
    HTTPHeader.SetValue("Content-Type", "application/json");

    try {
        var NumBatches = Platform.Function.Lookup("CA_CustomObjectKeyRange", "Batches", "Key", "CA_FY25_ContactsToBeArchived") + 1;

        // Retrieve folder IDs
        var BatchFolderName = "CA_Delete_Batches_2025";
        var BackupFolderName = "CA_BKUP_Batches_2025";

        var BatchFolderID = Folder.Retrieve({ Property: "Name", SimpleOperator: "equals", Value: BatchFolderName })[0].ID;
        var BackupFolderID = Folder.Retrieve({ Property: "Name", SimpleOperator: "equals", Value: BackupFolderName })[0].ID;

        for (var i = 1; i <= NumBatches; i++) {

            // Create Sendable Batch DE
            var batchDEName = "CA_2025_Batch" + i;
            var batchDE = {
                "CustomerKey": batchDEName,
                "Name": batchDEName,
                "CategoryID": BatchFolderID,
                "Fields": [
                    { "Name": "SubscriberKey", "FieldType": "Text", "MaxLength": 254, "IsPrimaryKey": true, "IsRequired": true },
                    { "Name": "EmailAddress", "FieldType": "EmailAddress" }
                ],
                "SendableInfo": {
                    "Field": { "Name": "SubscriberKey", "FieldType": "Text" },
                    "RelatesOn": "Subscriber Key"
                }
            };
            DataExtension.Add(batchDE);
            Write("(+) Sendable Batch DE created: " + batchDEName + "<br>");

            // Create Non-Sendable Backup DE
            var backupDEName = "CA_2025_BKUP_Batch" + i;
            var backupDE = {
                "CustomerKey": backupDEName,
                "Name": backupDEName,
                "CategoryID": BackupFolderID,
                "Fields": [
                    { "Name": "SubscriberKey", "FieldType": "Text", "MaxLength": 254, "IsPrimaryKey": true, "IsRequired": true },
                    { "Name": "EmailAddress", "FieldType": "EmailAddress" }
                ]
            };
            DataExtension.Add(backupDE);
            Write("(+) Backup DE created: " + backupDEName + "<br>");
        }

    } catch (error) {
        Write(Stringify(error));
    }

</script>
```
This SSJS script automates the creation of two sets of DEs for each deletion batch. It dynamically calculates the required number of batches, retrieves the corresponding folder IDs, and iterates through each batch to create both the sendable and backup DEs with the necessary fields. This approach ensures a structured, scalable, and restorable process for managing large-scale contact deletions.Upon execution, the script generates an equal number of Batch DEs and Backup DEs, aligned with the total batch count determined at the start of the deletion cycle.

💡Tip: f the SSJS script exceeds execution time limits in your account, consider splitting the logic into two separate scripts—one for creating deletion batch DEs and another for backup DEs.

## Step 3: Set Up Logging for Monitoring and Debugging

To effectively monitor the contact deletion process, I use two non-sendable DEs: one for process tracking and another for debugging.
  
The process log DE captures key events for each batch, including both batch creation and contact deletion. Since each batch generates two entries, I use a composite primary key consisting of ProcessDate and BatchName to ensure uniqueness. To maintain data integrity and avoid duplication, this DE is cleared at the start of each new deletion cycle. Here’s the schema for this DE, along with some illustrative data:

| Field Name   | Data Type (Length) | PK / Nullable   | Default Value  | Valid Values                | Example Data   |
|--------------|--------------------|-----------------|----------------|-----------------------------|----------------|
| ProcessDate  | Date               | Primary Key     | Current date   |                             | May 25, 2025   |
| BatchName    | Text (10)          | Nullable        |                |                             | S-1            |
| LastRowKey   | Number             | Nullable        |                |                             | 50,001         |
| BatchNum     | Number             | Nullable        |                |                             | 1              |
| Category     | Number             | Nullable        |                | BatchCreation, BatchDeletion| BatchCreation  |

For debugging, I maintain a lightweight non-sendable DE with two fields: a Log field (text, no length constraint) to store messages and errors, and a CreatedDate field to timestamp each entry. I also create a filtered DE to isolate logs for the current date, making it easier to troubleshoot recent activity. Given the potential for rapid growth, it’s important to apply a suitable data retention policy to this DE.

💡 Tips:
  - Create filtered DEs from the process and debug logs, to be able to focus on most recent logs.
  - The debug log  DE can grow pretty quickly, so it's important to have an appropriate data retention policy configured.

## Step 4: Populate the Batches

Once the batch and backup DEs are created, the next step is to populate them with contact data from the master list. This is done using two separate SSJS scripts: 
  - Script 1- Initialize the Process: The first script is run just once to initialize the process log and create the first few batches. 💡Tip: If the script times      out in your account, you can reduce the number of batches processed in this script by adjusting the loop variable (e.g., s < 3).
  - Script 2- Continue Batch Population via Automation: This script is intended to run as part of an automation (details in the next section) and picks up where       the first script stopped. It processes contact deletion batches incrementally throughout the day. By adjusting the 'EndBatch' variable, you can control how        many batches are processed in each run. The number of daily runs can also be adjusted depending on your Marketing Cloud instance’s performance and workload. I     usually schedule this one step automation to run three to four times a day for efficient processing without overloading the system.

Both the scripts retrieve rows from the master list ('ContactsToBeDeleted' DE) in batches of 50,000 contacts and then copies them into contact deletion and backup DEs. They also log the details for each batch, including last 'RowKey' processed, in the Process Log, which serves as a reference for the next batch of DE creation. Additionally, they handle errors and debugging by logging progress and errors in the Debug Log DE.

### Script 1- Initialize the Process

```javascript
<script runat="server" type="text/javascript">
    Platform.Load("Core",'1.1');
    
    var rowsData;
    var recordCount = 0;
    var source = DataExtension.Init("ContactsToBeDeleted");
    var totalProcessed = Platform.Function.Lookup('CA_CustomObjectKeyRange','StartRowIndex','Key','ContactsToBeDeleted_2025');
    var depre = "CA_2025_Batch";
    var bkpre = "CA_2025_BKUP_Batch";
    
    try {	
        for(s = 1; s<3; s++){
		var dekey = depre.concat(s);
		var DE = DataExtension.Init(dekey);
		var bkkey = bkpre.concat(s);
		var BK = DataExtension.Init(bkkey);
		var batchprocessed = 0;
		var arr = [];
		var max = 0;
		var log1 = Platform.Function.InsertData("CA_DebugLogs",["log"],["Batch DE Key = " + dekey]);
		
		do {    
			rowsData = source.Rows.Retrieve({Property:"RowKey",SimpleOperator:"greaterThanOrEqual",Value:totalProcessed});
			recordCount = rowsData.length;
			
			for( i = 0; i < recordCount; i++) {
				var SubKey = rowsData[i].SubscriberKey;
				var EmailAddr = rowsData[i].EmailAddress;
				max = rowsData[i].RowKey;
				var payload = {
					SubscriberKey: SubKey,
					EmailAddress: EmailAddr
					};
				var addedRowCount = DE.Rows.Add(payload);			
				var addedRowCount2 = BK.Rows.Add(payload);					
				arr.push(max);
				}
			arr.sort(function(a, b){return b-a});
			totalProcessed = arr[0];
			batchprocessed += recordCount;	
				  
			if(parseFloat(batchprocessed) >= 50000) {			
				break;
			}
			totalProcessed ++;   
		} while (recordCount > 0) 
	
	var processlog = Platform.Function.InsertData("CA_ProcessLog",["BatchName","LastRowKey", "BatchNum"],["S-"+s,totalProcessed, s]);
	var dbuglog = Platform.Function.InsertData("CA_DebugLogs",["log"],["Last processed row after the while Loop in " + "s" + s+ " = " + totalProcessed]);
	totalProcessed ++;
	}
    
} catch(e) {
    var debugDE = DataExtension.Init("CA_DebugLogs");
var arrDebug = [{log: 'Error in CA_2025_PopulateBatches js: ' + Stringify(e)}];
debugDE.Rows.Add(arrDebug);
}      
</script>
```
### Script 2: Continue Batch Population via Automation 

```javascript
<script runat="server" type="text/javascript">
  Platform.Load("Core",'1.1');
    
  var rowsData;
  var recordCount = 0;
  var source = DataExtension.Init("ContactsToBeDeleted");
    
  try {
      var processLogRows = Platform.Function.LookupOrderedRows("CA_ProcessLog",1,"LastRowKey desc","Category","BatchCreation");
      var totalProcessed = processLogRows[0]["LastRowKey"];
      var startBatch = 1.0 + processLogRows[0]["BatchNum"];
      var EndBatch = 1.0 + startBatch
      	
      var log1 = Platform.Function.InsertData("CA_DebugLogs",["log"],["Starting point : " + totalProcessed]);
      var depre = "CA_2025_Batch";
	    var bkpre = "CA_2025_BKUP_Batch";
      
      for(s = startBatch; s <= EndBatch; s++){
        var dekey = depre.concat(s);
		    var DE = DataExtension.Init(dekey);
		    var bkkey = bkpre.concat(s);
		    var BK = DataExtension.Init(bkkey);
		    var batchprocessed = 0;
	    	var arr = [];
        var max = 0;
        var log2 = Platform.Function.InsertData("CA_DebugLogs",["log"],["Batch DE Key = " + dekey]);
        
        do {    
          rowsData = source.Rows.Retrieve({Property:"RowKey",SimpleOperator:"greaterThan",Value:totalProcessed});
          recordCount = rowsData.length;
          
          for( i = 0; i < recordCount; i++) {
              var SubKey = rowsData[i].SubscriberKey;
              var EmailAddr = rowsData[i].EmailAddress;
              max = rowsData[i].RowKey;
              var payload = {
                    SubscriberKey: SubKey,
                    EmailAddress: EmailAddr
                    };	
			        var addedRowCount = DE.Rows.Add(payload);
              var addedRowCount2 = BK.Rows.Add(payload);			
			        arr.push(max);
          }
          
          arr.sort(function(a, b){return b-a});
          totalProcessed = arr[0];
          batchprocessed += recordCount;
                
          if(parseFloat(batchprocessed) >= 50000) {			
              break;
          }
      } while (recordCount > 0) 
		
		var processlog = Platform.Function.InsertData("CA_ProcessLog",["BatchName","LastRowKey", "BatchNum"],["S-"+s,totalProcessed, s]);
    var dbuglog = Platform.Function.InsertData("CA_DebugLogs",["log"],["Last processed row after the while Loop in " + "s" + s+ " = " + totalProcessed]);
		}
      
  } catch(e) {
      var debugDE = DataExtension.Init("CA_DebugLogs");
      var arrDebug = [{log: 'Error in CA_2025_PopulateBatches js: ' + Stringify(e)}];
      debugDE.Rows.Add(arrDebug);
    }     
</script> 
```
## Step 5: Deletion and Monitoring

The final step is to set up an automation to delete batches one by one. But first we need to create an API endpoint using SFMC’s REST API to automatically trigger contact deletion of the batches we created.

### Pre-requisite: Create an API endpoint

To implement this automated contact deletion, we need to create an endpoint (https://CLIENT_BASE.rest.marketingcloudapis.com/contacts/v1/contacts/actions/delete) with correct permissions, using the below steps:
- In the Setup in the Parent Business Unit, navigate to Platform Tools > Apps > Installed Packages.
- Click "New" and provide a name and description.
- Within the package, Add Component and select API Integration >> Server-to-Server integration.
- Choose Read and Write Permissions for List and Subscribers.
- Save and copy the Client Id, Client Secret, and Client Base.

Once the API endpoint is ready, create an SSJS script activity using this endpoint:
```javascript
<script language="javascript" runat="server"> 
	Platform.Load("core","1");
	
	// Retrieve the latest batch number from the process log and Initialize DE key
	var processLogRows = Platform.Function.LookupOrderedRows("CA_ProcessLog",1,"BatchNum desc","Category","BatchDeletion");
	var batchNm = 1.0;
	if (processLogRows.length > 0) {
	    batchNm += processLogRows[0]["BatchNum"];
	} 
	var depre = "CA_2025_Batch";
	var deKey = depre.concat(batchNm);
	var log1 = Platform.Function.InsertData("CA_DebugLogs",["log"],["Batch DE Key = " + deKey]);
	
	// Authenticate and get the access token
	var auth = HTTP.Post(
		'https://CLIENT_BASE.auth.marketingcloudapis.com/v2/token/', 
		'application/json', 
		'{"grant_type": "client_credentials","client_id":"CLIENT_IT","client_secret":"CLIENT_SECRET","account_id": "PARENTBU_MID"}'
	);
	
	var authobj = Platform.Function.ParseJSON(auth.Response[0]);
	try {
		// If the access token is available, proceed with the deletion request
	    	if (authobj.access_token) {
	    	    var del = HTTP.Post(
	                authobj.rest_instance_url+'contacts/v1/contacts/actions/delete?type=listReference', 
	                'application/json', 
	                '{
	                    "deleteOperationType":"ContactAndAttributes",
	                    "targetList":{
	                        "listKey":"' + deKey + '",
	                        "listType":{"listTypeID":3}
	                    },
	                    "deleteListWhenCompleted":false,
	                    "deleteListContentsWhenCompleted":true
	                }', 
	                ["Authorization"], 
	                ["Bearer " + authobj.access_token]
	            );
	            
	        // If there are no errors in the deletion response, update process log and log deletion response
		var delobj = Platform.Function.ParseJSON(del.Response[0]);
		if (delobj.hasErrors == false) {
		    var logthis = Platform.Function.InsertData("CA_ProcessLog",["BatchName","BatchNum", "Category"],["S-"+batchNm,batchNm, "BatchDeletion"]);
		    var debugDE = DataExtension.Init("CA_DebugLogs");
		    var arrDebug = [{log: 'delobj: ' + Stringify(delobj)}];
		    debugDE.Rows.Add(arrDebug);
		}
	    	}
    	} catch(e) {
            // Log any errors that occur during the process
            var debugDE = DataExtension.Init("RM_DebugLogs");
            var arrDebug = [{log: 'Error in Contact Deletion js: ' + Stringify(e)}];
            debugDE.Rows.Add(arrDebug);
        }
</script>
```
This script enables you to delete contacts based on the specific DE of the current batch in progress, which follows the batch previously deleted and logged in the process log. You pass the external key of the DE as listKey to the contact deletion endpoint. Next, create an automation with this script activity and schedule it to run at regular intervals, depending on the load and speed of the SFMC instance.

You can monitor the status of a contact deletion job at any time within the Contact Builder of the parent BU. To do this, navigate to Contact Builder and select Contact Analytics from the top menu. The dashboard will display completed jobs as green bars and any job in progress as blue bar. Click on any of the bars to examine the job status in detail.

💡Additional Tips: 
- You can configure API parameters to manage how the deletion DE and its contents are handled during the deletion operation.  When 'deleteListWhenCompleted' is 
  set to true, the DE will be deleted upon completion of the Contact Deletion process. And, when 'deleteListContentsWhenCompleted' is set to true, the records 
  within the DE will be deleted during the Contact Deletion process.
- I recommend starting with a 12-hour schedule for the automation and monitoring a few runs. Adjust the schedule based on the maximum time taken by any batch. To 
  prevent job, overlap, add an additional buffer of 2 hours. For example, if the maximum time taken by the job is 5.5 hours, schedule it to run every 8 hours.

