require('dotenv').config();
const { Telegraf } = require('telegraf');
const { google } = require('googleapis');

// Load environment variables
const botToken = process.env.TELEGRAM_BOT_TOKEN;
const sheetId = process.env.GOOGLE_SHEET_ID;
const apiKey = process.env.GOOGLE_API_KEY;

if (!botToken || !sheetId || !apiKey) {
  console.error('Error: Missing environment variables. Please check your .env file.');
  process.exit(1); // Exit the process if any environment variable is missing
}

console.log('Environment variables loaded successfully.');

// Initialize Telegram bot
const bot = new Telegraf(botToken);
console.log('Telegram bot initialized.');

// Google Sheets API Setup
const sheets = google.sheets({ version: 'v4', auth: apiKey });
console.log('Google Sheets API client initialized.');

// Function to fetch data from a Google Sheet
async function fetchSheetData(sheetName) {
  console.log(`Fetching data from Google Sheets for sheet: ${sheetName}`);
  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: sheetName,  // Fetch the entire sheet
    });
    console.log(`Data fetched successfully from sheet: ${sheetName}`);
    return response.data.values;
  } catch (error) {
    console.error(`Failed to fetch data from Google Sheets for sheet: ${sheetName}`, error);
    throw error;
  }
}

// Function to send a message to a Telegram group
async function sendMessageToGroup(chatId, projectData) {
  const message = `
Please review the Potential partner:

Project Name: ${projectData.projectName}
Twitter Link: ${projectData.twitterLink}
    
Would you like to proceed with this partnership?
  `;

  console.log(`Sending message to group with chat ID: ${chatId}`);
  try {
    const sentMessage = await bot.telegram.sendMessage(chatId, message, {
      reply_markup: {
        inline_keyboard: [
          [{ text: 'Yes', callback_data: `YES_${projectData.groupId}_${chatId}` }],
          [{ text: 'No', callback_data: `NO_${projectData.groupId}` }],
        ],
      },
    });
    console.log(`Message sent to group with chat ID: ${chatId}`);
    return sentMessage.message_id; // Return the message ID for future reference
  } catch (error) {
    console.error(`Failed to send message to group with chat ID: ${chatId}`, error);
  }
}

// Function to check if a group ID is in the Premium Projects list
async function isPremiumProjectGroup(chatId) {
  try {
    const premiumProjectsData = await fetchSheetData('Premium Projects');
    const premiumGroupIds = premiumProjectsData.slice(1).map(row => row[0]); // Assuming Group ID is in the first column
    return premiumGroupIds.includes(chatId.toString());
  } catch (error) {
    console.error('Error checking Premium Project group ID:', error);
    return false;
  }
}

// Track the last sent partner index for each project
const lastSentPartnerIndex = {};
const processedProjects = new Set(); // To prevent repeated clicks on Yes/No buttons

// Function to handle triggers based on required partnerships
async function handleTriggers(chatId) {
  try {
    // Fetch Partnership Tracking Projects data
    const trackingData = await fetchSheetData('Partnership Tracking Projects');

    console.log(`Processing project with group ID: ${chatId}`);

    let partnerFound = false;

    for (let k = 2; k < trackingData[0].length; k += 3) { // Step by 3 for each project block
      const projectName = trackingData[0][k - 1]; // Adjusted index for Project Name
      const twitterLink = trackingData[0][k];     // Adjusted index for Twitter Link

      if (!lastSentPartnerIndex[projectName]) {
        lastSentPartnerIndex[projectName] = 1; // Initialize index for this project
      }

      const partnerIndex = lastSentPartnerIndex[projectName];
      const totalPartners = trackingData.length - 1; // Subtracting 1 for the header row

      if (partnerIndex <= totalPartners) {
        const partnerData = {
          projectName: trackingData[partnerIndex][k - 1], // Adjusted index for Project Name
          twitterLink: trackingData[partnerIndex][k],     // Adjusted index for Twitter Link
          groupId: trackingData[partnerIndex][k + 1],     // Group ID remains the same
          projectId: `${partnerIndex}`, // Use the partner group ID as the project ID for callback
        };

        if (partnerData.projectName && partnerData.twitterLink && partnerData.groupId) {
          console.log(`Sending partner #${partnerIndex} for project: ${projectName}`);
          await sendMessageToGroup(chatId, partnerData);
          partnerFound = true;
        }

        lastSentPartnerIndex[projectName] += 1; // Move to the next partner for the next trigger

        if (lastSentPartnerIndex[projectName] > totalPartners) {
          lastSentPartnerIndex[projectName] = 1; // Reset to the beginning if we've sent all partners
        }
        break; // Send only one partner per project per trigger
      } else {
        console.log(`No more partners available for project: ${projectName}`);
      }
    }

    if (!partnerFound) {
      await bot.telegram.sendMessage(chatId, "We couldn't find any matches for today. As soon as we find suitable partners for you, we'll share them with you. Thank you for your patience!");
    }
  } catch (error) {
    console.error('Error handling triggers:', error);
  }
}

// Command for manual activation
bot.command('mypartner', async (ctx) => {
  const chatId = ctx.chat.id;

  const isPremium = await isPremiumProjectGroup(chatId);
  if (!isPremium && !['7036220043', '6610902479'].includes(chatId.toString())) {
    await ctx.reply("This functionality works only for Premium partners of Collably Network.");
    return;
  }

  await handleTriggers(chatId);

  // Set an interval to automatically trigger the function every 6 hours
  setInterval(async () => {
    await handleTriggers(chatId);
  }, 21600000); // 6 hours = 21600000 ms
});





// Handling Yes/No and Confirm Yes/No responses from Premium Projects
bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data;

  // Check if the project has already been processed
  if (processedProjects.has(data)) {
    return; // Ignore repeated clicks
  }

  processedProjects.add(data); // Prevent repeated clicks on the same button

  let yesText = 'Yes';
  let noText = 'No';
 
  // Handling initial YES callback
  if (data.startsWith('YES_')) {
    
    const [_, potentialGroupId, premiumGroupId] = data.split('_');
    console.log(`Received 'YES' from premium project for potential group ID: ${potentialGroupId}`);

    // Mark the selected button as "✔️ Yes"
    yesText = 'Accepted ✅';
    noText = ''; // Optionally mark "No" as unselected

    try {
      // Fetch Partnership Tracking Projects data
      const trackingData = await fetchSheetData('Partnership Tracking Projects');
      const premiumProjectName = trackingData[0][1];
      const premiumProjectTwitterLink = trackingData[0][2];
 
        // Fetch potential partner's data from trackingData or other source
        const potentialPartnerData =await trackingData.find(row => row[3] === potentialGroupId); // Adjust index based on your data
      const potentialPartnerName= potentialPartnerData[1];
      console.log(potentialPartnerName)
      // console.log(trackingData)
      console.log(`Sending potential project's details to premium project group.`);

      // Notify premium partner
      await bot.telegram.sendMessage(premiumGroupId, `Thank you for your interest. Please wait for confirmation from the  ${potentialPartnerName} team.`);

      // Send the potential project's details to the premium group's chat
      await bot.telegram.sendMessage(potentialGroupId, `
        A potential partner has shown interest:

Project Name: ${premiumProjectName}
Twitter Link: ${premiumProjectTwitterLink}

Please review and proceed with the partnership.
      `, {
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Yes', callback_data: `CONFIRM_YES_${potentialGroupId}_${premiumGroupId}_${potentialPartnerName}` }],
            [{ text: 'No', callback_data: `CONFIRM_NO_${potentialGroupId}_${premiumGroupId}_${potentialPartnerName}` }],
          ],
        },
      });
    } catch (error) {
      console.error('Error handling YES response:', error);
      await ctx.reply('Failed to notify the premium project.');
    }
  }

  // Handling initial NO callback
  else if (data.startsWith('NO_')) {
    const [_, potentialGroupId, ,potentialPartnerName] = data.split('_');
    console.log(potentialPartnerName)
    console.log(`Received 'NO' from premium project for project ID: ${potentialGroupId}`);

    // Mark the selected button as "❌ No"
    yesText = ''; // Optionally mark "Yes" as unselected
    noText = 'Rejected ❌';

    try {
      await ctx.reply("Ok! We'll find more suitable projects for you.");

      // Schedule the next project suggestion after 6 hours
      setTimeout(async () => {
        await handleTriggers(ctx.chat.id);
      }, 21600000); // 6 hours
    } catch (error) {
      console.error('Error scheduling next project:', error);
    }
  }

  // Update the button state for the initial Yes/No
  try {
    await bot.telegram.editMessageReplyMarkup(ctx.chat.id, ctx.callbackQuery.message.message_id, null, {
      inline_keyboard: [
        [{ text: yesText, callback_data: `DISABLED`, callback_data_disabled: true }],
        [{ text: noText, callback_data: `DISABLED`, callback_data_disabled: true }],
      ],
    });
  } catch (error) {
    console.error('Failed to disable the Yes/No buttons:', error);
  }

  // Handle CONFIRM_YES
  if (data.startsWith('CONFIRM_YES_')) {
    const [_, , potentialGroupId, premiumGroupId,potentialPartnerName] = data.split('_');
    console.log(`Received 'YES' from potential partner group ID: ${potentialGroupId}`);

    // Mark the selected confirm button as "✔️ Yes"
    yesText = 'Accepted ✅';
    noText = ''; // Optionally mark "Confirm No" as unselected

    try {
      // Notify potential partner group
      await bot.telegram.sendMessage(potentialGroupId, `
Thank you for your interest. Please create a group, and we'll invite the team for further discussion.
      `);

      // Notify premium partner that the potential partner accepted
      await bot.telegram.sendMessage(premiumGroupId, `
The potential partner ${potentialPartnerName} has accepted the partnership.
      `);
    } catch (error) {
      console.error('Error handling CONFIRM_YES response:', error);
      await ctx.reply('Failed to notify the premium project or potential partner.');
    }
  }

  // Handle CONFIRM_NO
  else if (data.startsWith('CONFIRM_NO_')) {
    const [_, , potentialGroupId, premiumGroupId,potentialPartnerName] = data.split('_');
    console.log(`Received 'NO' from potential partner  group ID: ${potentialGroupId}`);

    // Mark the selected confirm button as "❌ Confirm No"
    yesText = ''; // Optionally mark "Confirm Yes" as unselected
    noText = 'Rejected ❌';

    try {
      // Notify potential partner group
      await bot.telegram.sendMessage(potentialGroupId, `
Ok! We'll find more suitable projects for you.
      `);

      // Notify premium partner group
      await bot.telegram.sendMessage(premiumGroupId, `
${potentialPartnerName} is not interested in the project.
      `);
    } catch (error) {
      console.error('Error handling CONFIRM_NO response:', error);
      await ctx.reply('Failed to notify the potential partner.');
    }
  }

  // Update the button state for the Confirm Yes/No
  if (data.startsWith('CONFIRM_YES_') || data.startsWith('CONFIRM_NO_')) {
    try {
      await bot.telegram.editMessageReplyMarkup(ctx.chat.id, ctx.callbackQuery.message.message_id, null, {
        inline_keyboard: [
          [{ text: yesText, callback_data: `DISABLED`, callback_data_disabled: true }],
          [{ text: noText, callback_data: `DISABLED`, callback_data_disabled: true }],
        ],
      });
    } catch (error) {
      console.error('Failed to disable the Confirm Yes/No buttons:', error);
    }
  }
});


// Function to start the bot
bot.launch().then(() => {
  console.log('Bot is running...');
}).catch(error => {
  console.error('Failed to launch the bot:', error);
});

// Catch unhandled promise rejections
process.on('unhandledRejection', error => {
  console.error('Unhandled promise rejection:', error);
});

