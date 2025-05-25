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

| Field Name       | Data Type     | Length | Primary Key | Nullable |
|------------------|---------------|--------|-------------|----------|
| SubscriberKey    | Text          | 254    | Yes         | No       |
| EmailAddress     | EmailAddress  | 254    | No          | Yes      |
| RowKey           | Number        | —      | No          | No       |

Note that this DE should have a column to store the CustomObjectKey, a hidden identity field in Data Extensions. It is a unique number assigned to each row and can be queried using SQL and assigned to another column. This ‘RowKey’ column will be used later in the process to create batches for contact deletion.

