from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import FileResponse, HttpResponse
from django.urls import include, path, re_path


def react_app(request):
    """Serve the built React app (frontend/dist) for every page URL.

    React Router then shows the right page. During development, use the Vite
    dev server instead (npm run dev in frontend/), which forwards /api here.
    """
    index = settings.FRONTEND_DIST / 'index.html'
    if not index.exists():
        return HttpResponse(
            'The React app has not been built yet. Run "npm run build" in frontend/, '
            'or use the dev server: "npm run dev" in frontend/ and open http://localhost:5173/.',
            content_type='text/plain', status=503,
        )
    return FileResponse(index.open('rb'), content_type='text/html')


urlpatterns = [
    path('django-admin/', admin.site.urls),
    path('api/', include('config.api_urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

urlpatterns += [
    re_path(r'^(?!api/|django-admin/|media/|static/).*$', react_app),
]
