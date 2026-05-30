# Story Viewer Implementation Guide

## Overview

The Story Viewer system allows users to view stories in a full-screen modal with real-time viewer tracking. Stories are temporary posts that expire after 24 hours and show who has viewed them.

## Features Implemented

### 1. **Story Viewing Modal** ✅
- Full-screen story display
- Image and video support
- Story text overlay
- Author information with timestamp
- Expiry countdown timer

### 2. **Real-Time Viewer Tracking** ✅
- Live viewer list in sidebar
- Real-time viewer count
- Viewer profile images
- Viewer timestamps
- New viewer notifications

### 3. **Story Navigation** ✅
- Previous/Next buttons
- Keyboard navigation (Arrow keys)
- Auto-play (5 seconds per story)
- Progress bar showing position
- Escape key to close

### 4. **Story Expiry** ✅
- 24-hour expiry countdown
- Automatic story removal after expiry
- Time remaining display
- Formatted countdown (hours, minutes, seconds)

### 5. **Responsive Design** ✅
- Desktop: Side-by-side layout
- Tablet: Stacked layout
- Mobile: Full-screen optimized
- Touch-friendly navigation

## Backend Models

### Story Model
```python
class Story(models.Model):
    id = UUIDField(primary_key=True)
    author = ForeignKey(User)
    content = TextField(max_length=500)
    media_url = URLField()
    media_type = CharField(choices=[('image', 'Image'), ('video', 'Video')])
    view_count = IntegerField(default=0)
    created_at = DateTimeField(auto_now_add=True)
    expires_at = DateTimeField()  # 24 hours from creation
```

### StoryView Model
```python
class StoryView(models.Model):
    id = UUIDField(primary_key=True)
    story = ForeignKey(Story)
    viewer = ForeignKey(User)
    viewed_at = DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = ['story', 'viewer']
```

## API Endpoints

### Create Story
```bash
POST /api/social/stories/
Content-Type: application/json
Authorization: Bearer TOKEN

{
  "content": "Story text",
  "media_url": "https://...",
  "media_type": "image"
}
```

### Get Stories Feed
```bash
GET /api/social/stories/feed/
Authorization: Bearer TOKEN
```

### View Story
```bash
POST /api/social/stories/{id}/view/
Authorization: Bearer TOKEN
```

### Get Story Viewers
```bash
GET /api/social/stories/{id}/viewers/
Authorization: Bearer TOKEN
```

## Frontend Usage

### Open Story
```javascript
// Open a single story
storyViewer.openStory(storyId, storiesArray);

// Example
storyViewer.openStory('story-1', [{
    id: 'story-1',
    author: {
        username: 'user123',
        display_name: 'User Name',
        profile_image: 'https://...'
    },
    media_url: 'https://...',
    media_type: 'image',
    content: 'Story text',
    view_count: 45,
    created_at: '2024-01-01T12:00:00Z',
    expires_at: '2024-01-02T12:00:00Z',
    time_until_expiry: 86400
}]);
```

### Close Story
```javascript
storyViewer.closeStory();
```

### Navigate Stories
```javascript
storyViewer.nextStory();
storyViewer.previousStory();
```

## WebSocket Events

### Story Socket (`/ws/social/story/{storyId}/`)

**Viewer Joined:**
```json
{
  "type": "viewer_joined",
  "viewer": {
    "id": "user-id",
    "username": "username",
    "display_name": "Display Name",
    "profile_image": "https://..."
  }
}
```

**Viewers Updated:**
```json
{
  "type": "viewers_updated",
  "viewers": [...]
}
```

## File Structure

### Backend
- `django_backend/social/models.py` - Story and StoryView models
- `django_backend/social/serializers.py` - Story serializers
- `django_backend/social/views.py` - Story viewset
- `django_backend/social/urls.py` - Story URLs

### Frontend
- `scripts/story-viewer.js` - Story viewer class (600+ lines)
- `styles/story-viewer.css` - Story viewer styles (400+ lines)
- `index.html` - Updated with story viewer integration

## Key Features

### 1. Auto-Play
- Stories automatically advance after 5 seconds
- Can be interrupted by user navigation
- Continues through all stories in feed

### 2. Progress Bar
- Shows current position in story feed
- Visual indicator of progress
- Updates as user navigates

### 3. Expiry Countdown
- Shows time remaining until story expires
- Updates every second
- Formatted as "Xh Ym Zs"

### 4. Real-Time Viewers
- Sidebar shows all viewers
- Updates in real-time as new viewers watch
- Shows viewer profile images
- Displays view timestamp

### 5. Viewer Notifications
- Toast notification when someone views your story
- Shows viewer name and profile image
- Auto-dismisses after 3 seconds

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `←` | Previous story |
| `→` | Next story |
| `Esc` | Close viewer |

## Mobile Optimizations

### Responsive Breakpoints
- **Desktop (1024px+)**: Side-by-side layout
- **Tablet (768px-1023px)**: Stacked layout
- **Mobile (480px-767px)**: Full-screen optimized
- **Small Mobile (<480px)**: Compact layout

### Touch Interactions
- Tap left/right to navigate
- Tap close button to exit
- Swipe support (optional)

## Performance Considerations

### Database Queries
- Use `select_related()` for author
- Use `prefetch_related()` for views
- Index on `expires_at` for cleanup

### WebSocket Optimization
- Limit viewers list to 100 most recent
- Batch viewer updates
- Close socket on story close

### Image Optimization
- Use CDN for media storage
- Lazy load images
- Compress images before upload

## Security Features

✅ Authentication required for all endpoints
✅ Authorization checks (only author can see viewers)
✅ Input validation on story creation
✅ XSS protection on text overlay
✅ CORS protection
✅ Rate limiting ready

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile browsers (iOS Safari, Chrome Mobile)

## Known Limitations

1. **Single Story View** - Currently shows one story at a time
2. **No Story Editing** - Stories cannot be edited after creation
3. **No Story Deletion** - Stories auto-delete after 24 hours
4. **No Story Reactions** - No emoji reactions yet
5. **No Story Comments** - Comments not yet implemented

## Future Enhancements

1. **Story Reactions** - Add emoji reactions to stories
2. **Story Comments** - Allow commenting on stories
3. **Story Editing** - Edit stories before expiry
4. **Story Deletion** - Manual story deletion
5. **Story Filters** - Add filters/effects to stories
6. **Story Stickers** - Add stickers to stories
7. **Story Mentions** - Mention users in stories
8. **Story Hashtags** - Add hashtags to stories
9. **Story Analytics** - View story statistics
10. **Story Sharing** - Share stories to other platforms

## Troubleshooting

### Story Won't Open
- Check story ID is correct
- Verify story hasn't expired
- Check browser console for errors

### Viewers Not Updating
- Check WebSocket connection
- Verify Redis is running
- Check browser console for errors

### Expiry Timer Not Working
- Check JavaScript is enabled
- Verify timer is running
- Check browser console for errors

### Images Not Loading
- Check image URL is valid
- Verify CORS is configured
- Check image file size

## Testing

### Manual Testing
1. Create a story
2. Open story viewer
3. Check viewer list updates
4. Navigate between stories
5. Check expiry countdown
6. Close viewer

### Automated Testing
```javascript
// Test story viewer
const viewer = new StoryViewer();
viewer.openStory('test-id', testStories);
assert(viewer.currentStory !== null);
viewer.closeStory();
assert(viewer.currentStory === null);
```

## Deployment Checklist

- [ ] Database migrations run
- [ ] Story models created
- [ ] API endpoints working
- [ ] WebSocket configured
- [ ] Frontend scripts loaded
- [ ] CSS styles applied
- [ ] Story cards clickable
- [ ] Viewer list displays
- [ ] Real-time updates working
- [ ] Mobile responsive
- [ ] Performance optimized
- [ ] Security verified

## Support & Documentation

- **Setup Guide:** This file
- **API Documentation:** See REST endpoints above
- **WebSocket Events:** See event types above
- **Code Comments:** Inline documentation in source files

## Summary

The Story Viewer system provides a complete, real-time story viewing experience with:
- Full-screen story display
- Real-time viewer tracking
- Auto-play navigation
- Expiry countdown
- Responsive design
- WebSocket integration

Users can now view stories and see who's watching them in real-time! 🎉
