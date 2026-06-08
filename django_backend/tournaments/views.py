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