# 🚀 QUICK START - Sorted App

## ✅ GUARANTEED WORKING COMMANDS

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Start the App (Choose ONE method)

#### Method A: With QR Code for Mobile Testing
```bash
npx expo start
```

#### Method B: Web Only (Fastest)
```bash
npx expo start --web
```

#### Method C: Clear Cache + Start
```bash
npx expo start --clear
```

## 📱 What You'll See:

### For Mobile (Method A):
- ✅ Metro bundler in terminal
- ✅ QR code to scan with phone
- ✅ Press 'w' for web, 'i' for iOS, 'a' for Android

### For Web (Method B):
- ✅ Opens directly in browser
- ✅ Faster startup
- ✅ No mobile setup needed

## 🔧 If You Get Errors:

### "expo command not found"
```bash
npm run dev
```
(Uses npx automatically)

### "Module not found" errors
```bash
npm install
npx expo install --fix
```

### Cache issues
```bash
npx expo start --clear
```

### Complete reset
```bash
rm -rf node_modules package-lock.json
npm install
npx expo start
```

## 📲 Mobile Testing:
1. Install **Expo Go** app on your phone
2. Run `npx expo start`
3. Scan QR code with camera (iOS) or Expo Go app (Android)

## 🌐 Web Testing:
1. Run `npx expo start --web`
2. Browser opens automatically at localhost:8081

## ⚡ Quick Commands:
- `npm run dev` - Start with cache clear
- `npm run web` - Web only
- `npm start` - Standard start
- `npm run doctor` - Check for issues

**Ready to code! 🎉**