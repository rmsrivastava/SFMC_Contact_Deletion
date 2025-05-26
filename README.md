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
        var BatchFolderName = "CA_2025_Delete_Batches";
        var BackupFolderName = "CA_2025_BKUP_Batches";

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
This SSJS script automates the creation of two sets of DEs for each deletion batch. It dynamically calculates the required number of batches, retrieves the corresponding folder IDs, and iterates through each batch to create both the sendable and backup DEs with the necessary fields. This approach ensures a structured, scalable, and restartable process for managing large-scale contact deletions.Upon execution, the script generates an equal number of Batch DEs and Backup DEs, aligned with the total batch count determined at the start of the deletion cycle.

💡Tip: f the SSJS script exceeds execution time limits in your account, consider splitting the logic into two separate scripts—one for creating deletion batch DEs and another for backup DEs.





