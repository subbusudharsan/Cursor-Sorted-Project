#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import re

with open('app/contact-chat.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix 1: Add check before displaying in pregenerated_turns subscription
# Use a more flexible pattern that matches any whitespace
pattern1 = r'(return;\s*\}\s*)\s*(console\.log\([\'"]⚡ Realtime: Pregenerated options available)'
replacement1 = r'''\1
                // ✅ FIX: Check if same turn_number is already displayed - don't refresh if it is
                if (currentPregeneratedTurnRef.current && 
                    currentPregeneratedTurnRef.current.turn_number === pregen.turn_number &&
                    currentOptionsSourceRef.current === 'pregenerated_turns' &&
                    showSuggestedOptions) {
                  console.log(`⏸️ Skipping refresh: Same turn_number ${pregen.turn_number} already displayed`);
                  return; // ⛔ EXIT - don't refresh same turn
                }
                
                \2'''

content = re.sub(pattern1, replacement1, content, flags=re.MULTILINE | re.DOTALL)

# Fix 2: Add turn info storage
pattern2 = r'(await showOptionsWithDelay\(cleaned, [\'"]pregenerated_turns[\'"], pregen\.turn_number\);\s*)(resolveWaitingForOptions\(user\.id\);)'
replacement2 = r'''\1// ✅ Store turn info when displaying
                currentPregeneratedTurnRef.current = {
                  turn_number: pregen.turn_number,
                  recipient_id: user.id
                };
                \2'''

content = re.sub(pattern2, replacement2, content, flags=re.MULTILINE)

with open('app/contact-chat.tsx', 'w', encoding='utf-8') as f:
    f.write(content)

print("✅ Fixes applied!")








