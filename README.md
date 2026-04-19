# Live PDF Collaboration Classroom

A lightweight classroom app with:

- **PDF live annotation** synced between connected participants.
- **Live whiteboard** tab synced in real time.
- **3 roles**:
  - **Teacher**: controls student tool activation + can clear boards + upload PDF.
  - **Student**: can annotate/draw only when teacher enables each tool.
  - **Admin**: spectator mode (view-only, no mic/camera and cannot draw).
- **Teacher + Students** have browser audio/video using WebRTC.

## Run

```bash
npm install
npm start
```

Then open `http://localhost:3000` in multiple tabs/devices and join with different roles.

## Notes

- Only one teacher can be connected at a time.
- PDF upload is teacher-only and synced as a Data URL to all clients.
- Drawing sync is event-based over Socket.IO.
