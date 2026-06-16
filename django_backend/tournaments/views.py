"""
Tournament views for ARTX Platform
"""
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework import status


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def tournament_list(request):
    """Get list of tournaments"""
    # TODO: Implement tournament list
    return Response({'tournaments': []}, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def tournament_detail(request, tournament_id):
    """Get tournament details"""
    # TODO: Implement tournament detail
    return Response({'tournament': {}}, status=status.HTTP_200_OK)


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def join_tournament(request, tournament_id):
    """Join a tournament"""
    # TODO: Implement tournament join
    return Response({'message': 'Joined tournament'}, status=status.HTTP_200_OK)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def tournament_leaderboard(request):
    """
    Global leaderboard used by app.js.
    Returns the top 50 users sorted by prestige_points.
    """
    from users.models import User
    from django.db.models import F, Window
    from django.db.models.functions import RowNumber

    top_users = User.objects.filter(
        is_active=True
    ).annotate(
        rank=Window(
            expression=RowNumber(),
            order_by=F('prestige_points').desc()
        )
    ).order_by('-prestige_points').values(
        'id', 'username', 'display_name',
        'prestige_points', 'access_tier', 'rank'
    )[:50]

    return Response({
        'leaderboard': list(top_users)
    }, status=status.HTTP_200_OK)