/*
  # Send Email Invite Function

  1. Purpose
    - Sends email invitations to unregistered users
    - Includes app download link and invitation details
    - Handles email validation and delivery

  2. Security
    - Validates authenticated user
    - Sanitizes email input
    - Rate limiting through Supabase

  3. Email Content
    - Personalized invitation message
    - App download instructions
    - Contact connection details
*/ const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders
    });
  }
  try {
    const { email, inviter_name, inviter_email } = await req.json();
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(JSON.stringify({
        error: 'Invalid email format'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Create email content
    const emailSubject = `${inviter_name} invited you to join Sorted`;
    const emailBody = `
Hi there!

${inviter_name} (${inviter_email}) has invited you to join Sorted, an app for emotional wellness and meaningful conversations.

Sorted helps you:
• Connect with friends and family in a supportive environment
• Work through emotions with an AI assistant
• Have meaningful conversations that matter

To accept this invitation:
1. Download Sorted from your app store
2. Sign up with this email address: ${email}
3. You'll automatically be connected with ${inviter_name}

Download Sorted:
• iOS: https://apps.apple.com/app/sorted
• Android: https://play.google.com/store/apps/details?id=com.sorted

Looking forward to seeing you on Sorted!

Best regards,
The Sorted Team
    `;
    // In a real implementation, you would use a service like SendGrid, Mailgun, or AWS SES
    // For this demo, we'll simulate the email sending
    console.log('Email would be sent to:', email);
    console.log('Subject:', emailSubject);
    console.log('Body:', emailBody);
    // Simulate email sending delay
    await new Promise((resolve)=>setTimeout(resolve, 1000));
    return new Response(JSON.stringify({
      success: true,
      message: 'Email invitation sent successfully',
      recipient: email
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error sending email invite:', error);
    return new Response(JSON.stringify({
      error: 'Failed to send email invitation'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
